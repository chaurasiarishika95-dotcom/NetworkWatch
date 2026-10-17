'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HUBS,
  LANES,
  SCENARIOS,
  buildPlan,
  findPath,
  haversineKm,
} from '../lib/network';

const fmt = n =>
  Number(n || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  });

const fmt1 = n => {
  if (n === null || n === undefined || n === '') return '—';
  const value = Number(n);
  return Number.isFinite(value) ? value.toFixed(1) : '—';
};

function getWeatherSignal(reading) {
  if (!reading) return 'No reading';

  const rain = Number(reading.precipitation);
  const gust = Number(reading.windGusts);

  if (
    (Number.isFinite(rain) && rain >= 20) ||
    (Number.isFinite(gust) && gust >= 50)
  ) {
    return 'High · modelled';
  }

  if (
    (Number.isFinite(rain) && rain >= 10) ||
    (Number.isFinite(gust) && gust >= 40)
  ) {
    return 'Elevated · modelled';
  }

  if (
    (Number.isFinite(rain) && rain >= 5) ||
    (Number.isFinite(gust) && gust >= 30)
  ) {
    return 'Watch · modelled';
  }

  return 'Within prototype thresholds';
}

function getWeatherSignalStyle(signal) {
  if (signal.startsWith('High')) {
    return { color: '#a12626', background: '#fff0f0' };
  }

  if (signal.startsWith('Elevated')) {
    return { color: '#8a5100', background: '#fff1d6' };
  }

  if (signal.startsWith('Watch')) {
    return { color: '#805b00', background: '#fff8e8' };
  }

  if (signal.startsWith('Within')) {
    return { color: '#11765e', background: '#eaf7f1' };
  }

  return { color: 'var(--mute)', background: 'var(--panel)' };
}

export default function Home() {
  const [scenario, setScenario] = useState('monsoon');
  const [plan, setPlan] = useState(() => buildPlan('monsoon'));

  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState(
    'Loading live weather…'
  );
  const [weatherRefreshing, setWeatherRefreshing] = useState(false);
  const [weatherError, setWeatherError] = useState('');

  const [origin, setOrigin] = useState('DEL');
  const [destination, setDestination] = useState('JAI');

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [history, setHistory] = useState([]);

  const [roadRoute, setRoadRoute] = useState(null);
  const [roadLoading, setRoadLoading] = useState(false);

  // Retrieve live weather independently of the selected scenario.
  const refreshWeather = useCallback(async () => {
    setWeatherRefreshing(true);

    try {
      const response = await fetch(
        `/api/weather?refresh=${Date.now()}`,
        { cache: 'no-store' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Weather request failed');
      }

      if (
        data.source === 'unavailable' ||
        !Object.keys(data.readings || {}).length
      ) {
        setWeatherStatus('Weather unavailable; using simulated scenarios');
        setWeatherError(
          data.note || 'Live weather is temporarily unavailable.'
        );
        return;
      }

      setWeather(data);

      const count = Object.keys(data.readings || {}).length;
      const total = data.totalHubs || Object.keys(HUBS).length;

      setWeatherStatus(
        data.source === 'open-meteo' && count === total
          ? `Live Open-Meteo readings loaded (${count}/${total} hubs)`
          : `Partial weather readings (${count}/${total} hubs)`
      );

      setWeatherError('');
    } catch (error) {
      setWeatherStatus(
        'Weather refresh failed; last readings retained if available'
      );
      setWeatherError(
        error.message || 'Unable to refresh weather.'
      );
    } finally {
      setWeatherRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refreshWeather();
  }, [refreshWeather]);

  // Recalculate the plan when the scenario or weather data changes.
  useEffect(() => {
    const hasLiveWeather =
      weather?.source === 'open-meteo' ||
      weather?.source === 'open-meteo-partial';

    const readings = hasLiveWeather ? weather.readings : null;

    setPlan(buildPlan(scenario, readings));
  }, [scenario, weather]);

  // Retrieve previously saved scenarios from Supabase.
  useEffect(() => {
    fetch('/api/scenarios')
      .then(response => response.json())
      .then(data => {
        if (data.scenarios) setHistory(data.scenarios);
      })
      .catch(() => {});
  }, []);

  const selected = SCENARIOS[scenario];

  const laneByKey = useMemo(
    () => Object.fromEntries(plan.lanes.map(lane => [lane.key, lane])),
    [plan]
  );

  const chosenPath = useMemo(
    () => findPath(origin, destination, plan.lanes),
    [origin, destination, plan]
  );

  // Build road geometry for every leg of the recommended hub path.
  useEffect(() => {
    let active = true;

    setRoadLoading(true);
    setRoadRoute(null);

    async function loadPath() {
      if (!chosenPath?.nodes?.length) {
        setRoadRoute({
          source: 'unavailable',
          error: 'No feasible route exists under the selected disruption.',
        });
        setRoadLoading(false);
        return;
      }

      if (chosenPath.nodes.length === 1) {
        setRoadRoute({
          source: 'OSRM / OpenStreetMap',
          distanceKm: 0,
          durationMinutes: 0,
          coordinates: [[HUBS[origin].lon, HUBS[origin].lat]],
          segments: [],
          trafficAvailable: false,
          note: 'Origin and destination are the same hub.',
        });
        setRoadLoading(false);
        return;
      }

      try {
        const legs = await Promise.all(
          chosenPath.nodes.slice(0, -1).map(async (from, index) => {
            const to = chosenPath.nodes[index + 1];

            const response = await fetch(
              `/api/road-route?origin=${from}&destination=${to}`,
              { cache: 'no-store' }
            );

            const data = await response.json();

            if (!response.ok || !data.coordinates?.length) {
              throw new Error(
                data.error || `Road routing failed for ${from} → ${to}`
              );
            }

            return { ...data, from, to };
          })
        );

        const coordinates = [];

        for (const leg of legs) {
          const points = leg.coordinates || [];
          coordinates.push(
            ...(coordinates.length ? points.slice(1) : points)
          );
        }

        const sources = [...new Set(legs.map(leg => leg.source))];
        const trafficAvailable = legs.every(
          leg => leg.trafficAvailable === true
        );

        if (active) {
          setRoadRoute({
            source:
              sources.length === 1
                ? sources[0]
                : 'Mixed routing providers',

            distanceKm:
              Math.round(
                legs.reduce(
                  (sum, leg) => sum + (leg.distanceKm || 0),
                  0
                ) * 10
              ) / 10,

            durationMinutes: legs.reduce(
              (sum, leg) => sum + (leg.durationMinutes || 0),
              0
            ),

            coordinates,

            segments: legs.map(leg => ({
              from: leg.from,
              to: leg.to,
              distanceKm: leg.distanceKm,
              durationMinutes: leg.durationMinutes,
              source: leg.source,
              trafficAvailable: leg.trafficAvailable,
            })),

            trafficAvailable,

            note: trafficAvailable
              ? 'Route geometry and traffic-aware journey estimates come from the configured traffic provider. They are not a commercial-vehicle guarantee.'
              : 'Road geometry comes from OpenStreetMap/OSRM. Live traffic is not enabled for every leg; configure TOMTOM_API_KEY in Vercel to request traffic-aware estimates.',
          });
        }
      } catch (error) {
        if (active) {
          setRoadRoute({
            source: 'unavailable',
            error: error.message,
          });
        }
      } finally {
        if (active) setRoadLoading(false);
      }
    }

    loadPath();

    return () => {
      active = false;
    };
  }, [chosenPath, origin]);

  // Convert longitude/latitude route coordinates to SVG coordinates.
  const roadLine = useMemo(() => {
    const points = roadRoute?.coordinates;

    if (!points?.length) return '';

    const lons = points.map(point => point[0]);
    const lats = points.map(point => point[1]);

    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    const dx = maxLon - minLon || 1;
    const dy = maxLat - minLat || 1;

    return points
      .map(
        ([lon, lat]) =>
          `${12 + ((lon - minLon) / dx) * 576},${
            188 - ((lat - minLat) / dy) * 160
          }`
      )
      .join(' ');
  }, [roadRoute]);

  function chooseScenario(id) {
    setScenario(id);
    setAnswer('');
    setSaveMsg('');
  }

  async function saveScenario() {
    setSaving(true);
    setSaveMsg('Saving…');

    try {
      const response = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario,
          plan,
          question: question || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Save failed');
      }

      setSaveMsg(
        data.persisted
          ? 'Saved to Supabase.'
          : 'Saved for this session only. Check Supabase environment variables.'
      );

      if (data.scenarios) setHistory(data.scenarios);
    } catch (error) {
      setSaveMsg('Could not save scenario: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  async function askCopilot() {
    if (!question.trim()) return;

    setAnswer('Thinking…');

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          scenario: selected.name,
          description: selected.description,
          plan,
          weather,
        }),
      });

      const data = await response.json();
      setAnswer(data.text || data.error || 'No response.');
    } catch {
      setAnswer(
        'Copilot is unavailable. Review the route and impact data shown on this page.'
      );
    }
  }

  const impacted = plan.plans.filter(item => item.overflow > 0);
  const weatherReadings = weather?.readings || {};
  const weatherCount = Object.keys(weatherReadings).length;

  const lastWeatherUpdate = weather?.fetchedAt
    ? new Date(weather.fetchedAt).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  return (
    <main>
      <header className="hero">
        <div>
          <div className="eyebrow">
            INDIA LOGISTICS • DECISION SUPPORT PROTOTYPE
          </div>
          <h1>Network Watch</h1>
          <p className="sub">
            Disruption intelligence and capacity-aware recovery planning
            for an illustrative North India parcel network.
          </p>
        </div>
        <div className="pill">
          Synthetic network · Not Delhivery operational data
        </div>
      </header>

      <section className="card banner">
        <b>Operating principle</b>
        <span>
          Detect disruption → quantify exposure → compare feasible routes
          → explain the trade-off → record the decision.
        </span>
      </section>

      <div className="layout">
        <section className="card mapcard">
          <div className="sectionhead">
            <div>
              <div className="eyebrow">NETWORK OVERVIEW</div>
              <h2>North India hub &amp; lane network</h2>
            </div>
            <span className="live-dot">● {weatherStatus}</span>
          </div>

          <svg
            viewBox="0 0 800 390"
            role="img"
            aria-label="Schematic North India logistics hub network"
          >
            <defs>
              <pattern
                id="grid"
                width="25"
                height="25"
                patternUnits="userSpaceOnUse"
              >
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
              const risk = lane.cut > 0;

              return (
                <g key={lane.key}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={
                      lane.closed
                        ? 'var(--bad)'
                        : risk
                          ? 'var(--warn)'
                          : 'var(--ok)'
                    }
                    strokeWidth={risk ? 4 : 2.3}
                    strokeDasharray={lane.closed ? '7 5' : undefined}
                    opacity=".9"
                  >
                    <title>
                      {a.name} — {b.name}:{' '}
                      {fmt(lane.effectiveCapacity)} parcels/day effective
                      capacity
                    </title>
                  </line>
                </g>
              );
            })}

            {Object.values(HUBS).map(hub => {
              const cut = selected.hubCuts?.[hub.id] || 0;

              return (
                <g key={hub.id}>
                  <circle
                    cx={hub.x}
                    cy={hub.y}
                    r={hub.type === 'Gateway' ? 13 : 9}
                    fill={cut ? 'var(--bad)' : 'var(--panel)'}
                    stroke={cut ? 'var(--bad)' : 'var(--ink)'}
                    strokeWidth="2.5"
                  />
                  <text
                    x={hub.x + 13}
                    y={hub.y - 9}
                    className="maplabel"
                  >
                    {hub.name}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="legend">
            <span><i className="key ok" /> Available lane</span>
            <span><i className="key warn" /> Capacity reduced</span>
            <span><i className="key bad" /> Closed / hub disruption</span>
          </div>

          <p className="note">
            Schematic coordinates are for visualisation. Lane distances
            and transit times are illustrative; they are not actual road
            geometries.
          </p>
        </section>

        <aside className="card controls">
          <div className="eyebrow">SCENARIO LAB</div>
          <h2>Choose a disruption</h2>

          <div className="scenario-list">
            {Object.entries(SCENARIOS).map(([id, item]) => (
              <button
                key={id}
                className="scenario"
                aria-pressed={scenario === id}
                onClick={() => chooseScenario(id)}
              >
                <b>{item.name}</b>
                <small>{item.description}</small>
              </button>
            ))}
          </div>

          <div className="stats">
            <div>
              <small>Affected lanes</small>
              <strong>{plan.affectedLanes}</strong>
            </div>
            <div>
              <small>Capacity removed</small>
              <strong>{fmt(plan.capacityLost)}</strong>
              <small>parcels/day</small>
            </div>
            <div>
              <small>Potential overflow*</small>
              <strong>{fmt(plan.atRisk)}</strong>
              <small>parcels/day</small>
            </div>
          </div>

          <p className="note">
            *Modelled exposure estimate, not a forecast. It is based on
            synthetic lane demand assumptions and should not be interpreted
            as a shipment-level count.
          </p>

          <button
            className="primary"
            onClick={saveScenario}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save scenario & results'}
          </button>

          <p className="note">{saveMsg}</p>
        </aside>
      </div>

      {/* Separate live weather panel */}
      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">LIVE WEATHER</div>
            <h2>Current conditions across North India</h2>
            <p className="sub">
              Live weather is shown independently of the selected
              disruption scenario.
            </p>
          </div>

          <button
            className="primary"
            type="button"
            onClick={refreshWeather}
            disabled={weatherRefreshing}
          >
            {weatherRefreshing ? 'Refreshing…' : 'Refresh weather'}
          </button>
        </div>

        <p className="note">{weatherStatus}</p>

        {weatherCount > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))',
              gap: 12,
            }}
          >
            {Object.values(HUBS).map(hub => {
              const reading = weatherReadings[hub.id];
              const signal = getWeatherSignal(reading);
              const signalStyle = getWeatherSignalStyle(signal);

              return (
                <article
                  key={hub.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: 14,
                    background: 'var(--bg)',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                      marginBottom: 12,
                    }}
                  >
                    <div>
                      <b>{hub.name}</b>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--mute)',
                        }}
                      >
                        {hub.city}
                      </div>
                    </div>
                  </div>

                  {reading ? (
                    <>
                      <div
                        style={{
                          fontSize: 28,
                          fontWeight: 800,
                          marginBottom: 12,
                        }}
                      >
                        {fmt1(reading.temperature)}°C
                      </div>

                      <div style={{ marginBottom: 8 }}>
                        <small>Precipitation</small>
                        <div>
                          <b>{fmt1(reading.precipitation)} mm</b>
                        </div>
                      </div>

                      <div style={{ marginBottom: 8 }}>
                        <small>Wind speed</small>
                        <div>
                          <b>{fmt1(reading.windSpeed)} km/h</b>
                        </div>
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <small>Wind gusts</small>
                        <div>
                          <b>{fmt1(reading.windGusts)} km/h</b>
                        </div>
                      </div>

                      <span
                        className="pill"
                        style={{
                          display: 'inline-block',
                          color: signalStyle.color,
                          background: signalStyle.background,
                          whiteSpace: 'normal',
                        }}
                      >
                        {signal}
                      </span>

                      <p className="note">
                        Reading time: {reading.time || 'Unavailable'}
                      </p>
                    </>
                  ) : (
                    <p className="note">
                      No live reading available for this hub.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              border: '1px dashed var(--line)',
              borderRadius: 10,
              padding: 16,
            }}
          >
            <b>Live weather is unavailable.</b>
            <p className="note">
              Your simulated disruption scenarios remain available.
              Try refreshing the readings.
            </p>
          </div>
        )}

        <p className="note">
          {lastWeatherUpdate
            ? `Last API response: ${lastWeatherUpdate}. `
            : ''}
          Weather readings provide context, not confirmation of road
          closures. Risk labels use illustrative precipitation and wind
          thresholds; they are not official warnings or validated
          transport predictions.
        </p>

        {weatherError && <p className="note">{weatherError}</p>}
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">ROUTE EXPLORER</div>
            <h2>Compare an origin–destination path</h2>
          </div>
          <span className="pill">
            Scenario-aware · capacity-aware path
          </span>
        </div>

        <div className="routeform">
          <label>
            Origin
            <select
              value={origin}
              onChange={event => setOrigin(event.target.value)}
            >
              {Object.values(HUBS).map(hub => (
                <option key={hub.id} value={hub.id}>
                  {hub.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Destination
            <select
              value={destination}
              onChange={event => setDestination(event.target.value)}
            >
              {Object.values(HUBS).map(hub => (
                <option key={hub.id} value={hub.id}>
                  {hub.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {chosenPath ? (
          <div className="route-result">
            <div>
              <small>Recommended connected path</small>
              <strong>
                {chosenPath.nodes.map(id => HUBS[id].name).join(' → ')}
              </strong>
            </div>
            <div>
              <small>Modelled transit</small>
              <strong>{chosenPath.hours.toFixed(1)} h</strong>
            </div>
            <div>
              <small>Modelled cost</small>
              <strong>₹{chosenPath.cost.toFixed(2)}/parcel</strong>
            </div>
            <div>
              <small>Approx. straight-line distance</small>
              <strong>
                {fmt(
                  chosenPath.nodes.slice(1).reduce(
                    (sum, id, index) =>
                      sum +
                      haversineKm(
                        HUBS[chosenPath.nodes[index]],
                        HUBS[id]
                      ),
                    0
                  )
                )}{' '}
                km
              </strong>
            </div>
          </div>
        ) : (
          <p className="verdict">
            No feasible connected path under the selected lane conditions.
          </p>
        )}

        <div className="road-route-panel">
          <div className="sectionhead">
            <div>
              <div className="eyebrow">DISRUPTION-AWARE ROAD ROUTE</div>
              <h2>Road route for the recommended recovery path</h2>
            </div>

            <span className="pill">
              {roadLoading
                ? 'Building multi-leg road route…'
                : roadRoute?.trafficAvailable
                  ? 'Traffic-aware routing'
                  : roadRoute?.coordinates?.length
                    ? 'Road geometry · no live traffic'
                    : 'Road routing unavailable'}
            </span>
          </div>

          {roadRoute?.coordinates?.length > 1 ? (
            <>
              <svg
                viewBox="0 0 600 205"
                role="img"
                aria-label="Road route geometry from OpenStreetMap"
              >
                <rect
                  width="600"
                  height="205"
                  rx="10"
                  fill="var(--bg)"
                />

                <polyline
                  points={roadLine}
                  fill="none"
                  stroke="var(--ok)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {[
                  [
                    roadRoute.coordinates[0][0],
                    roadRoute.coordinates[0][1],
                    HUBS[origin].name,
                  ],
                  [
                    roadRoute.coordinates[
                      roadRoute.coordinates.length - 1
                    ][0],
                    roadRoute.coordinates[
                      roadRoute.coordinates.length - 1
                    ][1],
                    HUBS[destination].name,
                  ],
                ].map((point, index) => {
                  const coords = roadRoute.coordinates;
                  const lons = coords.map(c => c[0]);
                  const lats = coords.map(c => c[1]);

                  const minLon = Math.min(...lons);
                  const maxLon = Math.max(...lons);
                  const minLat = Math.min(...lats);
                  const maxLat = Math.max(...lats);

                  const x =
                    12 +
                    ((point[0] - minLon) / (maxLon - minLon || 1)) * 576;

                  const y =
                    188 -
                    ((point[1] - minLat) / (maxLat - minLat || 1)) * 160;

                  return (
                    <g key={index}>
                      <circle
                        cx={x}
                        cy={y}
                        r="6"
                        fill="var(--panel)"
                        stroke="var(--ink)"
                        strokeWidth="2"
                      />
                      <text
                        x={Math.min(510, x + 8)}
                        y={Math.max(16, y - 10)}
                        className="maplabel"
                      >
                        {point[2]}
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="route-result road-metrics">
                <div>
                  <small>Road distance</small>
                  <strong>{fmt(roadRoute.distanceKm)} km</strong>
                </div>
                <div>
                  <small>Estimated drive time</small>
                  <strong>
                    {Math.floor(roadRoute.durationMinutes / 60)}h{' '}
                    {roadRoute.durationMinutes % 60}m
                  </strong>
                </div>
                <div>
                  <small>Routing source</small>
                  <strong>{roadRoute.source || 'Road routing'}</strong>
                </div>
              </div>

              <p className="note">{roadRoute.note}</p>

              {roadRoute.segments?.length > 1 && (
                <p className="note">
                  Road legs follow the recommended hub sequence:{' '}
                  {roadRoute.segments
                    .map(
                      segment =>
                        `${HUBS[segment.from].name} → ${
                          HUBS[segment.to].name
                        }`
                    )
                    .join(' · ')}
                  .
                </p>
              )}
            </>
          ) : (
            <p className="note">
              {roadLoading
                ? 'Requesting road geometry…'
                : roadRoute?.error ||
                  'Road route unavailable. The synthetic network graph remains available.'}
            </p>
          )}
        </div>

        <p className="note">
          The selected scenario changes lane capacity and the recommended
          hub sequence; the road preview follows that sequence leg by leg.
          A modelled logistics-lane closure is not proof that a physical
          road is closed. Lane costs, capacity and transit-time weights
          remain synthetic. Live traffic requires a configured provider key.
        </p>
      </section>

      <section className="card">
        <div className="eyebrow">RECOVERY PLAN</div>
        <h2>Where the plan needs attention</h2>

        {impacted.length ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Affected lane</th>
                  <th>Capacity cut</th>
                  <th>Modelled overflow</th>
                  <th>Alternate path</th>
                  <th>Additional cost estimate</th>
                </tr>
              </thead>
              <tbody>
                {impacted.map(item => (
                  <tr key={item.lane}>
                    <td>
                      {HUBS[item.from].name} → {HUBS[item.to].name}
                    </td>
                    <td>
                      {Math.round(
                        (laneByKey[item.lane]?.cut || 0) * 100
                      )}
                      %
                    </td>
                    <td>{fmt(item.overflow)}</td>
                    <td>
                      {item.alternative
                        ? item.alternative
                            .map(id => HUBS[id].name)
                            .join(' → ')
                        : 'No feasible path'}
                    </td>
                    <td>
                      {item.extraCost == null
                        ? '—'
                        : `₹${fmt(item.extraCost)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="verdict">
            No modelled lane overflow in this scenario. Try another
            disruption to stress-test the network.
          </p>
        )}

        <p className="note">
          Alternative paths are indicative candidates. Full multi-shipment
          flow allocation and shipment-level promise protection remain
          future work; this iteration does not claim a globally optimal plan.
        </p>
      </section>

      <section className="card">
        <div className="eyebrow">AI OPERATIONS COPILOT</div>
        <h2>Ask about this scenario</h2>

        <p className="sub">
          The copilot should explain the scenario and results, not invent
          operational data.
        </p>

        <div className="prompts">
          {[
            'Which lanes are most affected and why?',
            'What trade-offs should an operations manager consider?',
            'What should we validate before approving this recovery plan?',
          ].map(prompt => (
            <button
              key={prompt}
              className="chip"
              onClick={() => setQuestion(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="askrow">
          <input
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="Ask about affected lanes, costs, capacity…"
          />
          <button className="primary" onClick={askCopilot}>
            Ask copilot
          </button>
        </div>

        {answer && <div className="answer">{answer}</div>}
      </section>

      <section className="card">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">PERSISTENCE</div>
            <h2>Saved scenario history</h2>
          </div>
          <span className="pill">Supabase-ready</span>
        </div>

        {history.length ? (
          <div className="history">
            {history.map((item, index) => (
              <div key={item.id || index}>
                <b>
                  {item.scenario_name || item.scenarioName || 'Scenario'}
                </b>
                <span>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleString()
                    : item.generatedAt
                      ? new Date(item.generatedAt).toLocaleString()
                      : 'Saved in current session'}
                </span>
                <small>
                  {item.summary ||
                    `${item.affected_lanes ??
                      item.affectedLanes ??
                      0} affected lanes`}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="note">
            No saved scenarios yet. Configure Supabase to persist scenario
            history across sessions.
          </p>
        )}
      </section>

      <footer className="note">
        Portfolio prototype • Synthetic demand, capacities and costs •
        Weather is contextual and modelled risk does not establish a road
        closure • Not affiliated with or using proprietary Delhivery data.
      </footer>
    </main>
  );
}
