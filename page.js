'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HUBS, SCENARIOS, buildPlan, getHubWeatherRisk } from '../lib/network';

const fmt = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const fmt1 = value => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : '—';
};

const displayPath = option => option?.hubNames?.join(' → ') || 'No route selected';

function weatherSignal(reading) {
  if (!reading) return { label: 'No reading', tone: 'none' };

  const rain = reading.precipitation == null ? NaN : Number(reading.precipitation);
  const gust = reading.windGusts == null ? NaN : Number(reading.windGusts);

  if ((Number.isFinite(rain) && rain >= 20) || (Number.isFinite(gust) && gust >= 50))
    return { label: 'High · modelled', tone: 'high' };

  if ((Number.isFinite(rain) && rain >= 10) || (Number.isFinite(gust) && gust >= 40))
    return { label: 'Elevated · modelled', tone: 'elevated' };

  if ((Number.isFinite(rain) && rain >= 5) || (Number.isFinite(gust) && gust >= 30))
    return { label: 'Watch · modelled', tone: 'watch' };

  return { label: 'Within prototype thresholds', tone: 'normal' };
}

function signalStyle(tone) {
  if (tone === 'high') return { color: '#a12626', background: '#fff0f0' };
  if (tone === 'elevated') return { color: '#8a5100', background: '#fff1d6' };
  if (tone === 'watch') return { color: '#805b00', background: '#fff8e8' };
  if (tone === 'normal') return { color: '#11765e', background: '#eaf7f1' };
  return { color: 'var(--mute)', background: 'var(--bg)' };
}

function formatDuration(minutes) {
  if (!Number.isFinite(Number(minutes))) return '—';
  const whole = Math.max(0, Math.round(Number(minutes)));
  return `${Math.floor(whole / 60)}h ${whole % 60}m`;
}

function routeLine(coordinates) {
  if (!coordinates?.length) return '';

  const lons = coordinates.map(point => point[0]);
  const lats = coordinates.map(point => point[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const dx = maxLon - minLon || 1;
  const dy = maxLat - minLat || 1;

  return coordinates
    .map(([lon, lat]) => `${12 + ((lon - minLon) / dx) * 576},${188 - ((lat - minLat) / dy) * 160}`)
    .join(' ');
}

export default function Home() {
  const [scenario, setScenario] = useState('baseline');
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState('Loading live weather…');
  const [weatherRefreshing, setWeatherRefreshing] = useState(false);
  const [weatherReady, setWeatherReady] = useState(false);
  const [weatherError, setWeatherError] = useState('');

  const [origin, setOrigin] = useState('JAI');
  const [destination, setDestination] = useState('DEL');
  const [parcelVolume, setParcelVolume] = useState('1000');
  const [routeAnalysis, setRouteAnalysis] = useState(null);
  const [activeOptionId, setActiveOptionId] = useState(null);
  const [routeLoading, setRouteLoading] = useState(true);
  const [routeError, setRouteError] = useState('');

  const [question, setQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [aiStatus, setAiStatus] = useState('Ask a question about this journey');
  const [chatLoading, setChatLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [history, setHistory] = useState([]);

  const weatherReadings = weather?.readings || {};
  const hasLiveWeather =
    weather?.source === 'open-meteo' ||
    weather?.source === 'open-meteo-partial';

  // Retrieve current weather independently of the selected scenario.
  const refreshWeather = useCallback(async () => {
    setWeatherRefreshing(true);

    try {
      const response = await fetch(`/api/weather?refresh=${Date.now()}`, {
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Weather request failed');
      }

      const count = Object.keys(data.readings || {}).length;

      if (data.source === 'unavailable' || count === 0) {
        setWeatherError(data.note || 'Live weather is temporarily unavailable.');
        setWeatherStatus('Weather unavailable; baseline route planning continues');
        return;
      }

      setWeather(data);
      setWeatherError('');

      const total = data.totalHubs || Object.keys(HUBS).length;

      setWeatherStatus(
        data.source === 'open-meteo'
          ? `Live Open-Meteo · ${count}/${total} hubs`
          : `Partial Open-Meteo · ${count}/${total} hubs`
      );
    } catch (error) {
      setWeatherError(error.message || 'Unable to refresh weather.');
      setWeatherStatus('Weather refresh failed; last readings retained if available');
    } finally {
      setWeatherRefreshing(false);
      setWeatherReady(true);
    }
  }, []);

  useEffect(() => {
    refreshWeather();
  }, [refreshWeather]);

  // Weather and scenario affect the current network plan.
  const plan = useMemo(
    () => buildPlan(scenario, hasLiveWeather ? weatherReadings : null),
    [scenario, weather]
  );

  // Analyse candidate paths and evaluate weather, traffic and capacity together.
  useEffect(() => {
    if (!weatherReady) return undefined;

    const controller = new AbortController();

    setRouteLoading(true);
    setRouteError('');
    setRouteAnalysis(null);
    setActiveOptionId(null);

    fetch('/api/route-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        origin,
        destination,
        scenario,
        weatherReadings: hasLiveWeather ? weatherReadings : null,
        weatherSource: weather?.source || 'unavailable',
        weatherFetchedAt: weather?.fetchedAt || null,
      }),
    })
      .then(async response => {
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Journey analysis failed');
        }

        return data;
      })
      .then(data => {
        setRouteAnalysis(data);
        setActiveOptionId(
          data.recommendedOptionId || data.options?.[0]?.id || null
        );
      })
      .catch(error => {
        if (error.name !== 'AbortError') {
          setRouteError(error.message || 'Journey analysis failed');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRouteLoading(false);
      });

    return () => controller.abort();
  }, [origin, destination, scenario, weather, weatherReady]);

  useEffect(() => {
    fetch('/api/scenarios')
      .then(response => response.json())
      .then(data => {
        if (data.scenarios) setHistory(data.scenarios);
      })
      .catch(() => {});
  }, []);

  const selectedScenario = SCENARIOS[scenario] || SCENARIOS.baseline;
  const options = routeAnalysis?.options || [];

  const recommendedOption =
    options.find(option => option.isRecommended) || options[0] || null;

  const activeOption =
    options.find(option => option.id === activeOptionId) ||
    recommendedOption;

  const plannedParcelVolume = Math.max(
    1,
    Math.min(1000000, Math.round(Number(parcelVolume) || 1))
  );

  const cheapestOption = options.length
    ? [...options].sort(
        (a, b) => a.syntheticCostPerParcel - b.syntheticCostPerParcel
      )[0]
    : null;

  const fastestOption = options.length
    ? [...options].sort((a, b) => a.drivingMinutes - b.drivingMinutes)[0]
    : null;

  const recommendedBatchCost = recommendedOption
    ? recommendedOption.syntheticCostPerParcel * plannedParcelVolume
    : null;

  const cheapestBatchCost = cheapestOption
    ? cheapestOption.syntheticCostPerParcel * plannedParcelVolume
    : null;

  const recommendedCostPremium =
    recommendedBatchCost == null || cheapestBatchCost == null
      ? null
      : Math.round(recommendedBatchCost - cheapestBatchCost);

  const recommendedTimePremium =
    recommendedOption && fastestOption
      ? recommendedOption.drivingMinutes - fastestOption.drivingMinutes
      : null;

  const activeBatchCost = activeOption
    ? activeOption.syntheticCostPerParcel * plannedParcelVolume
    : null;

  const routeNodes = activeOption?.nodes ||
    [origin, destination].filter((id, index, array) => array.indexOf(id) === index);

  // Only show weather at hubs along the currently selected route.
  const routeWeather = routeNodes
    .map(id => ({ id, hub: HUBS[id], reading: weatherReadings[id] }))
    .filter(item => item.hub);

  const routeWeatherCount = routeWeather.filter(item => item.reading).length;

  const linePoints = useMemo(
    () => routeLine(activeOption?.coordinates),
    [activeOption?.coordinates]
  );

  const laneByKey = useMemo(
    () => Object.fromEntries(plan.lanes.map(lane => [lane.key, lane])),
    [plan]
  );

  const selectedLaneKeys = useMemo(
    () => new Set(activeOption?.laneKeys || []),
    [activeOption]
  );

  const networkImpacts = plan.plans
    .filter(item => item.overflow > 0)
    .slice(0, 8);

  const weatherTime = weather?.fetchedAt
    ? new Date(weather.fetchedAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  const decisionReasons = useMemo(() => {
    if (!activeOption) return [];

    const reasons = [];

    if (activeOption.trafficCoveragePct === 100) {
      reasons.push('Live traffic data is available for every leg of this candidate.');
    } else if (activeOption.trafficCoveragePct > 0) {
      reasons.push(
        `Live traffic is available for ${activeOption.trafficCoveragePct}% of this candidate's legs; remaining legs use baseline road estimates.`
      );
    } else {
      reasons.push(
        'No live traffic estimate is available for this candidate; its drive time uses baseline road estimates.'
      );
    }

    if (activeOption.weatherHubIds?.length) {
      reasons.push(
        `Weather is available for ${activeOption.weatherHubIds.length} of ${activeOption.nodes.length} hubs on this route.`
      );
    }

    if (activeOption.maxWeatherRiskPct >= 12) {
      reasons.push(
        `The route includes a hub/leg with elevated modelled weather exposure (peak rule-based score ${activeOption.maxWeatherRiskPct}%).`
      );
    } else {
      reasons.push(
        'No route hub crosses the higher prototype weather-risk thresholds in the latest readings.'
      );
    }

    if (activeOption.capacityPressureCount > 0) {
      reasons.push(
        `${activeOption.capacityPressureCount} leg(s) have modelled capacity pressure under the selected scenario.`
      );
    }

    if (activeOption.isRecommended) {
      reasons.push('This is the top-ranked feasible candidate among the hub paths evaluated.');
    } else {
      reasons.push(
        `The system's top-ranked candidate is ${displayPath(recommendedOption)}; compare time, traffic coverage, weather exposure and cost before choosing this alternative.`
      );
    }

    return reasons;
  }, [activeOption, recommendedOption]);

  const operationalSuggestions = useMemo(() => {
    if (!activeOption) return [];

    const suggestions = [];

    if (activeOption.trafficCoveragePct < 100) {
      suggestions.push(
        'Treat the displayed journey time as partly or fully baseline road time until live traffic is returned for every leg.'
      );
    } else if ((activeOption.trafficDelayMinutes || 0) >= 15) {
      suggestions.push(
        `Review alternatives before dispatch: the route has about ${activeOption.trafficDelayMinutes} minutes of reported traffic delay.`
      );
    } else {
      suggestions.push(
        'Refresh traffic close to dispatch, because road conditions can change after this snapshot.'
      );
    }

    if (activeOption.maxWeatherRiskPct >= 12) {
      const affected = activeOption.nodes
        .filter(id => getHubWeatherRisk(weatherReadings[id]) >= 0.12)
        .map(id => HUBS[id].name);

      suggestions.push(
        `Verify current local advisories and road conditions around ${affected.join(', ') || 'the exposed route hubs'} before dispatch; hub weather is a proxy, not a road-closure feed.`
      );
    }

    if (activeOption.capacityPressureCount > 0) {
      suggestions.push(
        `Confirm downstream capacity before reallocating volume: ${activeOption.capacityPressureCount} selected-route leg(s) have modelled capacity pressure.`
      );
    } else {
      suggestions.push(
        'Confirm actual parcel volume and hub throughput against the latest operational plan; this prototype uses synthetic capacity data.'
      );
    }

    return suggestions;
  }, [activeOption, weatherReadings]);

  async function saveScenario() {
    if (!activeOption) return;

    setSaving(true);
    setSaveMsg('Saving journey and scenario…');

    try {
      const response = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario,
          plan,
          weather: weather
            ? {
                ...weather,
                readings: Object.fromEntries(
                  routeNodes
                    .filter(id => weatherReadings[id])
                    .map(id => [id, weatherReadings[id]])
                ),
              }
            : null,

          routeContext: {
            origin,
            destination,
            plannedParcelVolume,
            estimatedTotalTransportCostINR:
              activeBatchCost == null ? null : Math.round(activeBatchCost),

            recommendedPath: recommendedOption?.hubNames || [],
            selectedPath: activeOption.hubNames,

            options: options.map(option => ({
              path: option.hubNames,
              distanceKm: option.distanceKm,
              drivingMinutes: option.drivingMinutes,
              trafficCoveragePct: option.trafficCoveragePct,
              trafficDelayMinutes: option.trafficDelayMinutes,
              avgWeatherRiskPct: option.avgWeatherRiskPct,
              capacityPressureCount: option.capacityPressureCount,
              syntheticCostPerParcel: option.syntheticCostPerParcel,
              estimatedTotalTransportCostINR: Math.round(
                option.syntheticCostPerParcel * plannedParcelVolume
              ),
              plannedParcelVolume,
              score: option.score,
            })),

            selectedMetrics: activeOption,
          },

          question: question || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Save failed');

      setSaveMsg(
        data.persisted
          ? 'Journey saved to Supabase.'
          : 'Saved to temporary memory only. Check Supabase environment variables.'
      );

      if (data.scenarios) setHistory(data.scenarios);
    } catch (error) {
      setSaveMsg(`Could not save journey: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function askCopilot() {
    const currentQuestion = question.trim();

    if (!currentQuestion || chatLoading || !activeOption) return;

    const priorMessages = chatMessages.slice(-10);
    const nextMessages = [
      ...chatMessages,
      { role: 'user', text: currentQuestion },
    ];

    setChatMessages(nextMessages);
    setQuestion('');
    setChatLoading(true);
    setAiStatus('Analysing selected journey…');

    try {
      const candidateHubIds = [
        ...new Set(options.flatMap(option => option.nodes || [])),
      ];

      const relevantReadings = Object.fromEntries(
        candidateHubIds
          .filter(id => weatherReadings[id])
          .map(id => [id, weatherReadings[id]])
      );

      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: currentQuestion,
          messages: priorMessages,
          scenario: selectedScenario.name,
          scenarioId: scenario,
          description: selectedScenario.description,
          plan,
          weather: weather
            ? { ...weather, readings: relevantReadings }
            : { source: 'unavailable', readings: {} },

          routeContext: {
            origin,
            destination,
            plannedParcelVolume,
            estimatedTotalTransportCostINR:
              activeBatchCost == null ? null : Math.round(activeBatchCost),

            originName: HUBS[origin].name,
            destinationName: HUBS[destination].name,
            recommendedPath: recommendedOption?.hubNames || [],
            selectedPath: activeOption.hubNames,
            graphPath: activeOption.hubNames,
            modelledHours: activeOption.drivingMinutes / 60,
            modelledCostPerParcel: activeOption.syntheticCostPerParcel,
            roadDistanceKm: activeOption.distanceKm,
            roadDurationMinutes: activeOption.drivingMinutes,
            routingSource: activeOption.source,
            trafficAvailable: activeOption.trafficAvailable,
            trafficCoveragePct: activeOption.trafficCoveragePct,
            trafficDelayMinutes: activeOption.trafficDelayMinutes,
            weatherStatus: activeOption.weatherStatus,
            capacityPressureCount: activeOption.capacityPressureCount,
            selectedRouteScore: activeOption.score,

            candidateOptions: options.map(option => ({
              path: option.hubNames,
              distanceKm: option.distanceKm,
              drivingMinutes: option.drivingMinutes,
              trafficCoveragePct: option.trafficCoveragePct,
              trafficDelayMinutes: option.trafficDelayMinutes,
              maxWeatherRiskPct: option.maxWeatherRiskPct,
              capacityPressureCount: option.capacityPressureCount,
              syntheticCostPerParcel: option.syntheticCostPerParcel,
              estimatedTotalTransportCostINR: Math.round(
                option.syntheticCostPerParcel * plannedParcelVolume
              ),
              plannedParcelVolume,
              score: option.score,
              recommended: option.isRecommended,
            })),

            routeStatus: routeLoading
              ? 'loading'
              : routeError
                ? 'unavailable'
                : activeOption.source,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Copilot request failed');
      }

      setChatMessages([
        ...nextMessages,
        {
          role: 'assistant',
          text: data.text || 'No response returned.',
          source: data.source,
        },
      ]);

      setAiStatus(
        data.source === 'Gemini'
          ? `Gemini connected · ${data.model || 'model'}`
          : 'Fallback mode · configure GEMINI_API_KEY'
      );
    } catch (error) {
      setChatMessages([
        ...nextMessages,
        {
          role: 'assistant',
          text: `Copilot request failed: ${error.message}. Check the Gemini key and Vercel function logs.`,
          source: 'error',
        },
      ]);

      setAiStatus('Copilot request failed');
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <main>
      <header className="hero">
        <div>
          <div className="eyebrow">INDIA LOGISTICS • DECISION SUPPORT PROTOTYPE</div>
          <h1>Network Watch</h1>
          <p className="sub">
            One connected journey view: evaluate live road-time estimates and
            route-hub weather, then compare recovery options under capacity
            constraints.
          </p>
        </div>
        <div className="pill">Synthetic network · Not Delhivery operational data</div>
      </header>

      <section className="card banner">
        <b>Journey decision flow</b>
        <span>
          Choose origin/destination → inspect conditions on candidate paths →
          compare options → review why a route is recommended → ask Gemini or
          save the decision.
        </span>
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">1 · JOURNEY SETUP</div>
            <h2>Where are you moving parcels?</h2>
            <p className="sub">
              The selection below drives the route candidates, route-specific
              weather cards, traffic metrics, recommendations and copilot context.
            </p>
          </div>

          <button
            className="primary"
            type="button"
            onClick={refreshWeather}
            disabled={weatherRefreshing}
          >
            {weatherRefreshing ? 'Refreshing weather…' : 'Refresh live weather'}
          </button>
        </div>

        <div className="routeform" style={{ maxWidth: '920px' }}>
          <label>
            Origin
            <select value={origin} onChange={event => setOrigin(event.target.value)}>
              {Object.values(HUBS).map(hub => (
                <option key={hub.id} value={hub.id}>{hub.name}</option>
              ))}
            </select>
          </label>

          <label>
            Destination
            <select value={destination} onChange={event => setDestination(event.target.value)}>
              {Object.values(HUBS).map(hub => (
                <option key={hub.id} value={hub.id}>{hub.name}</option>
              ))}
            </select>
          </label>

          <label>
            Scenario overlay
            <select
              value={scenario}
              onChange={event => {
                setScenario(event.target.value);
                setChatMessages([]);
                setSaveMsg('');
              }}
            >
              <option value="baseline">Live conditions only · no simulated disruption</option>
              {Object.entries(SCENARIOS)
                .filter(([id]) => id !== 'baseline')
                .map(([id, item]) => (
                  <option key={id} value={id}>{item.name}</option>
                ))}
            </select>
          </label>

          <label>
            Planning parcel volume
            <input
              type="number"
              min="1"
              max="1000000"
              step="100"
              value={parcelVolume}
              onChange={event => setParcelVolume(event.target.value)}
              style={{
                display: 'block',
                width: '100%',
                marginTop: 5,
                padding: 10,
                border: '1px solid var(--line)',
                borderRadius: 8,
                background: 'white',
                color: 'var(--ink)',
                font: 'inherit',
              }}
            />
            <small style={{ display: 'block', marginTop: 4 }}>
              Used to estimate this journey's total transport cost.
            </small>
          </label>
        </div>

        <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div>
            <small>Current journey</small>
            <strong style={{ fontSize: 16 }}>{HUBS[origin].name}</strong>
            <small>to {HUBS[destination].name}</small>
          </div>
          <div>
            <small>Route weather coverage</small>
            <strong style={{ fontSize: 16 }}>
              {activeOption ? `${routeWeatherCount}/${routeNodes.length} hubs` : 'Checking…'}
            </strong>
            <small>{weatherTime || 'Waiting for weather response'}</small>
          </div>
          <div>
            <small>Traffic feed</small>
            <strong style={{ fontSize: 16 }}>
              {activeOption ? `${activeOption.trafficCoveragePct}% coverage` : 'Checking…'}
            </strong>
            <small>
              {activeOption?.trafficAvailable
                ? 'Live traffic on every leg'
                : 'Baseline / partial traffic estimates'}
            </small>
          </div>
          <div>
            <small>Route analysis</small>
            <strong style={{ fontSize: 16 }}>
              {routeLoading ? 'Analysing…' : `${options.length} candidates`}
            </strong>
            <small>{routeAnalysis?.scenarioName || 'Waiting for analysis'}</small>
          </div>
        </div>

        <p className="note">
          {weatherStatus}. Live traffic is available only when TomTom returns
          traffic data; otherwise route options use baseline OSRM road-time
          estimates. Weather readings come from Open-Meteo at modelled hub
          coordinates.
        </p>

        {weatherError && <p className="note">Weather note: {weatherError}</p>}
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">2 · ROUTE OPTIONS</div>
            <h2>
              Compare routes for {HUBS[origin].name} → {HUBS[destination].name}
            </h2>
            <p className="sub">
              The engine ranks candidate hub paths by estimated driving time,
              route-hub weather exposure, modelled capacity pressure and synthetic
              parcel cost. It is not a global multi-shipment optimiser.
            </p>
          </div>
          <span className="pill">
            {activeOption?.trafficAvailable
              ? 'Traffic-aware comparison'
              : 'Road-time comparison'}
          </span>
        </div>

        {!routeLoading && !routeError && recommendedOption && (
          <div
            style={{
              border: '1px solid var(--ok)',
              borderRadius: 12,
              padding: 16,
              background: '#f2faf7',
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'flex-start',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: '1 1 340px' }}>
                <div className="eyebrow">RECOMMENDED RECOVERY SOLUTION</div>
                <h3 style={{ margin: '4px 0 8px', fontSize: 21 }}>
                  {displayPath(recommendedOption)}
                </h3>
                <p style={{ margin: 0 }}>
                  Recommended for {HUBS[origin].name} → {HUBS[destination].name}
                  {' '}under <b>{selectedScenario.name}</b>, based on the candidate
                  paths evaluated using road time, weather exposure, capacity
                  pressure and modelled lane cost.
                </p>
              </div>

              <button
                className="primary"
                type="button"
                onClick={() => setActiveOptionId(recommendedOption.id)}
                disabled={activeOption?.id === recommendedOption.id}
              >
                {activeOption?.id === recommendedOption.id
                  ? 'Recommended solution selected'
                  : 'Apply recommended solution'}
              </button>
            </div>

            <div
              className="stats"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                marginTop: 14,
              }}
            >
              <div>
                <small>Estimated drive time</small>
                <strong style={{ fontSize: 21 }}>
                  {formatDuration(recommendedOption.drivingMinutes)}
                </strong>
                <small>
                  {recommendedTimePremium === 0
                    ? 'Fastest evaluated candidate'
                    : recommendedTimePremium > 0
                      ? `${formatDuration(recommendedTimePremium)} slower than fastest`
                      : `${formatDuration(Math.abs(recommendedTimePremium || 0))} faster than fastest`}
                </small>
              </div>

              <div>
                <small>Road distance</small>
                <strong style={{ fontSize: 21 }}>
                  {fmt(recommendedOption.distanceKm)} km
                </strong>
                <small>{recommendedOption.trafficCoveragePct}% traffic coverage</small>
              </div>

              <div>
                <small>Modelled cost per parcel</small>
                <strong style={{ fontSize: 21 }}>
                  ₹{fmt1(recommendedOption.syntheticCostPerParcel)}
                </strong>
                <small>Synthetic lane rates</small>
              </div>

              <div>
                <small>Total for {fmt(plannedParcelVolume)} parcels</small>
                <strong style={{ fontSize: 21 }}>₹{fmt(recommendedBatchCost)}</strong>
                <small>Illustrative transport cost</small>
              </div>

              <div>
                <small>Route weather risk</small>
                <strong style={{ fontSize: 21 }}>
                  {recommendedOption.maxWeatherRiskPct}%
                </strong>
                <small>Highest hub risk score</small>
              </div>

              <div>
                <small>Capacity pressure</small>
                <strong style={{ fontSize: 21 }}>
                  {recommendedOption.capacityPressureCount} leg(s)
                </strong>
                <small>
                  {fmt(recommendedOption.estimatedOverflowParcelsPerDay)}
                  {' '}parcels/day estimated overflow
                </small>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 12,
                marginTop: 12,
              }}
            >
              <div
                style={{
                  background: 'white',
                  border: '1px solid var(--line)',
                  borderRadius: 9,
                  padding: 12,
                }}
              >
                <b>Cost trade-off</b>
                <p style={{ margin: '6px 0 0' }}>
                  {recommendedCostPremium != null && recommendedCostPremium <= 0
                    ? 'This is the lowest-cost candidate among the routes evaluated.'
                    : `The recommendation is approximately ₹${fmt(recommendedCostPremium)} more than the lowest-cost candidate for ${fmt(plannedParcelVolume)} parcels.`}
                </p>
                <p className="note">
                  This is a modelled comparison, not a vendor quote or Delhivery cost.
                </p>
              </div>

              <div
                style={{
                  background: 'white',
                  border: '1px solid var(--line)',
                  borderRadius: 9,
                  padding: 12,
                }}
              >
                <b>Why this route ranks first</b>
                <p style={{ margin: '6px 0 0' }}>
                  Score components: {fmt(recommendedOption.scoreParts?.drivingMinutes)}
                  {' '}drive minutes + {fmt(recommendedOption.scoreParts?.weatherPenaltyMinutes)}
                  {' '}weather penalty + {fmt(recommendedOption.scoreParts?.capacityPenaltyMinutes)}
                  {' '}capacity penalty + {fmt(recommendedOption.scoreParts?.syntheticCostPenaltyMinutes)}
                  {' '}weighted cost penalty.
                </p>
                <p className="note">
                  The score uses prototype weights and ranks a bounded candidate
                  set; it is not a globally optimal shipment-flow plan.
                </p>
              </div>
            </div>

            <p className="note" style={{ marginTop: 10 }}>
              Suggested action: use this path as the first recovery candidate,
              then validate actual parcel volume, hub/lane capacity and physical
              road conditions before dispatch. Choose an alternative below to
              compare its impact; the weather cards, leg details, map and Gemini
              context will follow the selected route.
            </p>
          </div>
        )}

        {routeLoading ? (
          <div className="verdict">
            Checking road times and traffic for candidate legs, then comparing
            route conditions…
          </div>
        ) : routeError ? (
          <div className="verdict">
            {routeError}
            <p className="note">
              The weather and simulated scenario remain available; retry by
              changing the route or refreshing the page.
            </p>
          </div>
        ) : !options.length ? (
          <div className="verdict">
            No feasible connected route was found under the current scenario.
            Try a different scenario or origin/destination.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {options.map((option, index) => {
              const active = option.id === activeOption?.id;

              return (
                <article
                  key={option.id}
                  style={{
                    border: `1px solid ${active ? 'var(--ok)' : 'var(--line)'}`,
                    borderRadius: 12,
                    padding: 14,
                    background: active ? '#f5fbf8' : 'var(--panel)',
                    boxShadow: active ? 'inset 0 0 0 1px var(--ok)' : 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <b>
                      {option.isRecommended ? 'Recommended route' : `Alternative ${index}`}
                    </b>
                    <span className="pill">
                      {active
                        ? 'Selected'
                        : option.trafficCoveragePct === 100
                          ? 'Live traffic'
                          : 'Baseline / partial'}
                    </span>
                  </div>

                  <div style={{ fontWeight: 750, lineHeight: 1.45, marginBottom: 12 }}>
                    {displayPath(option)}
                  </div>

                  <div className="stats" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 0 }}>
                    <div>
                      <small>Estimated road time</small>
                      <strong style={{ fontSize: 18 }}>
                        {formatDuration(option.drivingMinutes)}
                      </strong>
                    </div>

                    <div>
                      <small>Road distance</small>
                      <strong style={{ fontSize: 18 }}>
                        {fmt(option.distanceKm)} km
                      </strong>
                    </div>

                    <div>
                      <small>Traffic coverage</small>
                      <strong style={{ fontSize: 18 }}>
                        {option.trafficCoveragePct}%
                      </strong>
                      <small>
                        {option.trafficDelayMinutes == null
                          ? 'Delay unavailable'
                          : `Known delay: ${option.trafficDelayMinutes} min`}
                      </small>
                    </div>

                    <div>
                      <small>Peak route weather risk</small>
                      <strong style={{ fontSize: 18 }}>
                        {option.maxWeatherRiskPct}%
                      </strong>
                      <small>
                        {option.weatherHubIds.length}/{option.nodes.length} hubs have readings
                      </small>
                    </div>
                  </div>

                  <p className="note">
                    Capacity pressure: {option.capacityPressureCount} leg(s) ·
                    Modelled cost: ₹{fmt1(option.syntheticCostPerParcel)}/parcel ·
                    Total for {fmt(plannedParcelVolume)} parcels:
                    {' '}₹{fmt(option.syntheticCostPerParcel * plannedParcelVolume)}
                  </p>

                  <button
                    className="primary"
                    style={{ width: '100%', marginTop: 12 }}
                    onClick={() => setActiveOptionId(option.id)}
                    disabled={active}
                  >
                    {active ? 'Currently selected' : 'Use this route'}
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {activeOption && (
          <div className="answer">
            <b>
              {activeOption.isRecommended
                ? 'Why this route is recommended'
                : 'You selected an alternative route'}
            </b>

            <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
              {decisionReasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>

            <p className="note">
              Ranking formula: estimated road minutes + modelled weather/capacity
              penalties + synthetic parcel-cost weighting. Displayed scores and
              operational penalties are prototype assumptions.
            </p>

            <h3 style={{ marginBottom: 6 }}>Suggested next actions</h3>
            <ul style={{ marginTop: 0, marginBottom: 0, paddingLeft: 18 }}>
              {operationalSuggestions.map(suggestion => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">3 · CONDITIONS ALONG THE SELECTED ROUTE</div>
            <h2>{activeOption ? displayPath(activeOption) : 'Route conditions'}</h2>
            <p className="sub">
              Only hubs on the currently selected path are shown here. Selecting
              another candidate above updates this section and the map.
            </p>
          </div>
          <span className="pill">
            {routeWeatherCount}/{routeWeather.length} hub readings available
          </span>
        </div>

        {routeWeather.length ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 10,
            }}
          >
            {routeWeather.map(({ id, hub, reading }) => {
              const signal = weatherSignal(reading);
              const style = signalStyle(signal.tone);

              return (
                <article
                  key={id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: 13,
                    background: 'var(--bg)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div>
                      <b>{hub.name}</b>
                      <div style={{ color: 'var(--mute)', fontSize: 11 }}>
                        {hub.type} · route hub
                      </div>
                    </div>
                    <span
                      className="pill"
                      style={{
                        background: style.background,
                        color: style.color,
                        whiteSpace: 'normal',
                      }}
                    >
                      {signal.label}
                    </span>
                  </div>

                  {reading ? (
                    <>
                      <div style={{ fontSize: 27, fontWeight: 800, margin: '10px 0' }}>
                        {fmt1(reading.temperature)}°C
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 10px' }}>
                        <div>
                          <small>Precipitation</small>
                          <div><b>{fmt1(reading.precipitation)} mm</b></div>
                        </div>
                        <div>
                          <small>Wind speed</small>
                          <div><b>{fmt1(reading.windSpeed)} km/h</b></div>
                        </div>
                        <div>
                          <small>Wind gusts</small>
                          <div><b>{fmt1(reading.windGusts)} km/h</b></div>
                        </div>
                        <div>
                          <small>Reading time</small>
                          <div>
                            <b style={{ fontSize: 11 }}>
                              {reading.time
                                ? new Date(reading.time).toLocaleTimeString('en-IN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'Asia/Kolkata',
                                  })
                                : '—'}
                            </b>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="note">No live reading for this hub.</p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="note">
            Choose a route to inspect conditions at its modelled hub coordinates.
          </p>
        )}

        {activeOption?.segments?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h3>Leg-by-leg operating conditions</h3>

            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Leg</th>
                    <th>Road time</th>
                    <th>Traffic delay</th>
                    <th>Model capacity</th>
                    <th>Weather capacity impact</th>
                    <th>Leg status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOption.segments.map(segment => (
                    <tr key={`${segment.from}>${segment.to}`}>
                      <td>{segment.fromName} → {segment.toName}</td>
                      <td>
                        {segment.durationMinutes == null
                          ? 'Fallback estimate'
                          : formatDuration(segment.durationMinutes)}
                      </td>
                      <td>
                        {segment.trafficDelayMinutes == null
                          ? 'Unavailable'
                          : `${segment.trafficDelayMinutes} min`}
                      </td>
                      <td>{fmt(segment.effectiveCapacity)} parcels/day</td>
                      <td>{Math.round(segment.weatherCut * 100)}% modelled</td>
                      <td>
                        {segment.effectiveCapacity <= 0
                          ? 'Closed in simulation'
                          : segment.estimatedOverflow > 0
                            ? 'Capacity pressure'
                            : segment.weatherCut > 0
                              ? 'Weather watch'
                              : 'No modelled lane alert'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="note">
          Open-Meteo readings are taken at modelled hub coordinates and used as
          corridor proxies, not at every point on the road. Weather risk
          thresholds are illustrative and do not verify road safety or closures.
          Live traffic appears only for legs where the provider returns traffic data.
        </p>
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">4 · ROUTE MAP & NETWORK CONTEXT</div>
            <h2>Selected route in the North India network</h2>
            <p className="sub">
              The highlighted links follow the selected route; other links show
              network context and scenario exposure.
            </p>
          </div>
          <span className="pill">
            {activeOption ? `${activeOption.nodes.length} hubs in selected path` : 'No route selected'}
          </span>
        </div>

        <svg
          viewBox="0 0 800 390"
          role="img"
          aria-label="North India hub network with the currently selected route highlighted"
        >
          <defs>
            <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse">
              <path
                d="M 25 0 L 0 0 0 25"
                fill="none"
                stroke="var(--line)"
                strokeWidth=".55"
                opacity=".6"
              />
            </pattern>
          </defs>

          <rect width="800" height="390" fill="url(#grid)" rx="12" />

          {plan.lanes.map(lane => {
            const a = HUBS[lane.from];
            const b = HUBS[lane.to];
            const onRoute = selectedLaneKeys.has(lane.key);
            const risk = lane.cut > 0;

            const color = lane.closed
              ? 'var(--bad)'
              : onRoute
                ? risk ? 'var(--warn)' : 'var(--ok)'
                : risk
                  ? 'var(--warn)'
                  : 'var(--line)';

            return (
              <g key={lane.key}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth={onRoute ? 4.5 : risk ? 2.5 : 1.5}
                  strokeDasharray={lane.closed ? '7 5' : undefined}
                  opacity={onRoute ? 1 : risk ? 0.9 : 0.65}
                >
                  <title>
                    {a.name} → {b.name}; effective modeled capacity
                    {' '}{fmt(lane.effectiveCapacity)} parcels/day; weather
                    adjustment {Math.round((lane.weatherCut || 0) * 100)}%
                  </title>
                </line>
              </g>
            );
          })}

          {Object.values(HUBS).map(hub => {
            const onRoute = routeNodes.includes(hub.id);
            const readingRisk = getHubWeatherRisk(weatherReadings[hub.id]);
            const scenarioHubCut = selectedScenario.hubCuts?.[hub.id] || 0;

            return (
              <g key={hub.id}>
                <circle
                  cx={hub.x}
                  cy={hub.y}
                  r={hub.type === 'Gateway' ? 13 : 9}
                  fill={scenarioHubCut ? 'var(--bad)' : onRoute ? '#e8f7f1' : 'var(--panel)'}
                  stroke={
                    scenarioHubCut
                      ? 'var(--bad)'
                      : onRoute && readingRisk >= 0.12
                        ? 'var(--warn)'
                        : onRoute
                          ? 'var(--ok)'
                          : 'var(--ink)'
                  }
                  strokeWidth={onRoute ? 3 : 2}
                >
                  <title>
                    {hub.name}; {onRoute ? 'on selected route' : 'not on selected route'};
                    {' '}modelled weather-risk score {Math.round(readingRisk * 100)}%
                  </title>
                </circle>
                <text x={hub.x + 13} y={hub.y - 9} className="maplabel">
                  {hub.name}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="legend">
          <span><i className="key ok" /> Selected route</span>
          <span><i className="key warn" /> Reduced capacity / weather risk</span>
          <span><i className="key bad" /> Closed in selected simulation</span>
        </div>

        <div className="stats">
          <div>
            <small>Network affected lanes</small>
            <strong>{plan.affectedLanes}</strong>
          </div>
          <div>
            <small>Modelled capacity removed</small>
            <strong>{fmt(plan.capacityLost)}</strong>
            <small>parcels/day</small>
          </div>
          <div>
            <small>Modelled overflow exposure</small>
            <strong>{fmt(plan.atRisk)}</strong>
            <small>parcels/day</small>
          </div>
        </div>

        <p className="note">
          The network-wide numbers describe the full synthetic network, while
          the live route options above describe only the selected origin–destination
          journey. Capacity, demand and costs are illustrative rather than Delhivery data.
        </p>
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">5 · AI OPERATIONS COPILOT</div>
            <h2>Ask about this journey</h2>
            <p className="sub">
              Gemini receives the selected path, alternatives, route-hub weather,
              traffic coverage and capacity constraints shown above.
            </p>
          </div>
          <span className="pill">{aiStatus}</span>
        </div>

        <div className="prompts">
          {[
            'Why is this route recommended over the alternatives?',
            'Which hubs on this route have the highest weather risk?',
            'How much traffic delay is known, and where is it unavailable?',
            'Suggest an action before dispatch, using only the data shown.',
          ].map(prompt => (
            <button key={prompt} className="chip" onClick={() => setQuestion(prompt)}>
              {prompt}
            </button>
          ))}
        </div>

        {chatMessages.length > 0 && (
          <div style={{ display: 'grid', gap: 10, margin: '12px 0' }}>
            {chatMessages.map((message, index) => (
              <div
                key={`${index}-${message.role}`}
                className="answer"
                style={{
                  marginTop: 0,
                  background: message.role === 'user' ? '#edf7f4' : 'var(--bg)',
                }}
              >
                <b style={{ display: 'block', fontSize: 11, marginBottom: 5 }}>
                  {message.role === 'user'
                    ? 'You'
                    : message.source === 'Gemini'
                      ? 'Gemini · Network Watch'
                      : 'Network Watch'}
                </b>
                {message.text}
              </div>
            ))}
          </div>
        )}

        <div className="askrow">
          <input
            value={question}
            onChange={event => setQuestion(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                askCopilot();
              }
            }}
            placeholder="Ask why this route is better, about traffic or weather…"
          />
          <button
            className="primary"
            onClick={askCopilot}
            disabled={chatLoading || !question.trim() || !activeOption}
          >
            {chatLoading ? 'Thinking…' : 'Ask Gemini'}
          </button>
        </div>

        <p className="note">
          Set GEMINI_API_KEY in Vercel to enable Gemini. If the key is missing,
          the API returns a clearly labelled fallback answer. Route suggestions
          remain decision support for a human to validate.
        </p>
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">6 · OPTIONAL HISTORY</div>
            <h2>Decision history</h2>
            <p className="sub">
              The recommendation and cost estimate above are the main output.
              Save this decision only if you want to review it later.
            </p>
          </div>

          <button
            className="chip"
            onClick={saveScenario}
            disabled={saving || !activeOption}
          >
            {saving ? 'Saving…' : 'Save decision for later'}
          </button>
        </div>

        <p className="note">{saveMsg}</p>

        {history.length ? (
          <div className="history">
            {history.map((item, index) => (
              <div key={item.id || index}>
                <b>{item.scenario_name || item.scenarioName || 'Scenario'}</b>
                <span>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : item.generatedAt
                      ? new Date(item.generatedAt).toLocaleString()
                      : 'Saved in this session'}
                </span>
                <small>
                  {item.summary ||
                    `${item.affected_lanes ?? item.affectedLanes ?? 0} affected lanes`}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="note">Saved journeys returned by Supabase will appear here.</p>
        )}
      </section>

      <footer className="note">
        Portfolio prototype • Hub coordinates are used as corridor weather proxies
        • Synthetic capacity and cost data • Not affiliated with or using proprietary
        Delhivery data.
      </footer>
    </main>
  );
}
