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

const fmt1 = n =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(1) : '—';

function getWeatherSignal(reading) {
  if (!reading) {
    return {
      label: 'No reading',
      color: 'var(--mute)',
      background: 'var(--panel)',
    };
  }

  const rain = Number(reading.precipitation);
  const gust = Number(reading.windGusts);

  if (
    (Number.isFinite(rain) && rain >= 20) ||
    (Number.isFinite(gust) && gust >= 50)
  ) {
    return {
      label: 'High · rule-based',
      color: '#9f2424',
      background: '#fff0f0',
    };
  }

  if (
    (Number.isFinite(rain) && rain >= 10) ||
    (Number.isFinite(gust) && gust >= 40)
  ) {
    return {
      label: 'Elevated · rule-based',
      color: '#8a5100',
      background: '#fff5df',
    };
  }

  if (
    (Number.isFinite(rain) && rain >= 5) ||
    (Number.isFinite(gust) && gust >= 30)
  ) {
    return {
      label: 'Watch · rule-based',
      color: '#8a5100',
      background: '#fff8e8',
    };
  }

  return {
    label: 'Normal by prototype thresholds',
    color: 'var(--ok)',
    background: '#eef8f4',
  };
}

export default function Home() {
  const [scenario, setScenario] = useState('monsoon');
  const [plan, setPlan] = useState(() => buildPlan('monsoon'));

  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] =
    useState('Loading live weather…');
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

      if (data.source === 'unavailable') {
        setWeather(current =>
          current?.readings &&
          Object.keys(current.readings).length
            ? current
            : data
        );

        setWeatherStatus(
          'Weather unavailable; showing last readings if available'
        );

        setWeatherError(
          data.note || 'Live weather is temporarily unavailable.'
        );
      } else {
        setWeather(data);

        const count = Object.keys(data.readings || {}).length;

        setWeatherStatus(
          data.source === 'open-meteo'
            ? 'Live Open-Meteo readings loaded'
            : `Partial weather readings: ${count}/${
                data.totalHubs || Object.keys(HUBS).length
              } hubs`
        );

        setWeatherError('');
      }
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

  // Load weather independently of the selected disruption scenario.
  useEffect(() => {
    refreshWeather();
  }, [refreshWeather]);

  // Load saved scenario history from the existing API.
  useEffect(() => {
    fetch('/api/scenarios')
      .then(response => response.json())
      .then(data => {
        if (data.scenarios) {
          setHistory(data.scenarios);
        }
      })
      .catch(() => {});
  }, []);

  const selected = SCENARIOS[scenario];

  const laneByKey = useMemo(
    () =>
      Object.fromEntries(
        plan.lanes.map(lane => [lane.key, lane])
      ),
    [plan]
  );

  const chosenPath = useMemo(
    () => findPath(origin, destination, plan.lanes),
    [origin, destination, plan]
  );

  // Build real road geometry for each leg of the recommended hub path.
  useEffect(() => {
    let active = true;

    setRoadLoading(true);
    setRoadRoute(null);

    async function loadPath() {
      if (!chosenPath?.nodes?.length) {
        setRoadRoute({
          source: 'unavailable',
          error:
            'No feasible route exists under the selected disruption.',
        });

        setRoadLoading(false);
        return;
      }

      if (chosenPath.nodes.length === 1) {
        setRoadRoute({
          source: 'OSRM / OpenStreetMap',
          distanceKm: 0,
          durationMinutes: 0,
          coordinates: [
            [HUBS[origin].lon, HUBS[origin].lat],
          ],
          segments: [],
          trafficAvailable: false,
          note: 'Origin and destination are the same hub.',
        });

        setRoadLoading(false);
        return;
      }

      try {
        const legs = await Promise.all(
          chosenPath.nodes.slice(0, -1).map(
            async (from, i) => {
              const to = chosenPath.nodes[i + 1];

              const response = await fetch(
                `/api/road-route?origin=${from}&destination=${to}`,
                { cache: 'no-store' }
              );

              const data = await response.json();

              if (!response.ok || !data.coordinates?.length) {
                throw new Error(
                  data.error ||
                    `Road routing failed for ${from} → ${to}`
                );
              }

              return { ...data, from, to };
            }
          )
        );

        const coordinates = [];

        for (const leg of legs) {
          const points = leg.coordinates || [];

          coordinates.push(
            ...(coordinates.length ? points.slice(1) : points)
          );
        }

        const sources = [
          ...new Set(legs.map(leg => leg.source)),
        ];

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
              (sum, leg) =>
                sum + (leg.durationMinutes || 0),
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
              ? 'Route geometry and traffic-aware journey estimates are provided by the configured traffic provider. Estimates are not a commercial-vehicle guarantee.'
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
        if (active) {
          setRoadLoading(false);
        }
      }
    }

    loadPath();

    return () => {
      active = false;
    };
  }, [chosenPath, origin]);

  // Convert longitude/latitude coordinates to SVG coordinates.
  const roadLine = useMemo(() => {
    const points = roadRoute?.coordinates;

    if (!points?.length) {
      return '';
    }

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
    setPlan(buildPlan(id));
    setAnswer('');
    setSaveMsg('');
  }

  async function saveScenario() {
    setSaving(true);
    setSaveMsg('Saving…');

    try {
      const response = await fetch('/api/scenarios', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
          : 'Saved for this session only. Add Supabase environment variables to persist it.'
      );

      if (data.scenarios) {
        setHistory(data.scenarios);
      }
    } catch (error) {
      setSaveMsg(
        'Could not save scenario: ' + error.message
      );
    } finally {
      setSaving(false);
    }
  }

  async function askCopilot() {
    if (!question.trim()) {
      return;
    }

    setAnswer('Thinking…');

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          scenario: selected.name,
          description: selected.description,
          plan,
          weather,
        }),
      });

      const data = await response.json();

      setAnswer(
        data.text || data.error || 'No response.'
      );
    } catch {
      setAnswer(
        'Copilot is unavailable. Review the route and impact data shown on this page.'
      );
    }
  }

  const impacted = plan.plans.filter(
    item => item.overflow > 0
  );

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
            Disruption intelligence and capacity-aware recovery
            planning for an illustrative North India parcel network.
          </p>
        </div>

        <div className="pill">
          Synthetic network · Not Delhivery operational data
        </div>
      </header>

      <section className="card banner">
        <b>Operating principle</b>
        <span>
          Detect disruption → quantify exposure → compare feasible
          routes → explain the trade-off → record the decision.
        </span>
      </section>

      <div className="layout">
        <section className="card mapcard">
          <div className="sectionhead">
            <div>
              <div className="eyebrow">NETWORK OVERVIEW</div>
              <h2>North India hub &amp; lane network</h2>
            </div>

            <span className="live-dot">
              ● {weatherStatus}
            </span>
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

            <rect
              width="800"
              height="390"
              fill="url(#grid)"
              rx="12"
            />

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
                    strokeDasharray={
                      lane.closed ? '7 5' : undefined
                    }
                    opacity=".9"
                  >
                    <title>
                      {a.name} — {b.name}:{' '}
                      {fmt(lane.effectiveCapacity)} parcels/day
                      effective capacity
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
            and travel times are illustrative; they are not actual road
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
            synthetic lane demand assumptions and should not be
            interpreted as a shipment-level count.
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

      {/* Live weather is separate from the simulated Scenario Lab. */}
      <section className="card weather-panel">
        <div className="sectionhead">
          <div>
            <div className="eyebrow">LIVE WEATHER</div>

            <h2>Current conditions across North India hubs</h2>

            <p className="sub">
              Independent of the selected disruption scenario. Readings
              come from Open-Meteo for each hub's coordinates.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            <span className="pill">{weatherStatus}</span>

            <button
              className="primary"
              type="button"
              onClick={refreshWeather}
              disabled={weatherRefreshing}
            >
              {weatherRefreshing
                ? 'Refreshing…'
                : 'Refresh weather'}
            </button>
          </div>
        </div>

        {weatherCount > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))',
              gap: 10,
            }}
          >
            {Object.values(HUBS).map(hub => {
              const reading = weatherReadings[hub.id];
              const signal = getWeatherSignal(reading);

              return (
                <article
                  key={hub.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    padding: 12,
                    background: 'var(--bg)',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <b>{hub.name}</b>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--mute)',
                        }}
                      >
                        {hub.city}
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 750,
                        padding: '4px 7px',
                        borderRadius: 999,
                        color: signal.color,
                        background: signal.background,
                        textAlign: 'right',
                      }}
                    >
                      {signal.label}
                    </span>
                  </div>

                  {reading ? (
                    <>
                      <div
                        style={{
                          fontSize: 27,
                          fontWeight: 800,
                          letterSpacing: '-.04em',
                          lineHeight: 1.2,
                          marginBottom: 10,
                        }}
                      >
                        {fmt1(reading.temperature)}°C
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '8px 12px',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mute)' }}>
                            Precipitation
                          </div>
                          <b>{fmt1(reading.precipitation)} mm</b>
                        </div>

                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mute)' }}>
                            Wind speed
                          </div>
                          <b>{fmt1(reading.windSpeed)} km/h</b>
                        </div>

                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mute)' }}>
                            Wind gusts
                          </div>
                          <b>{fmt1(reading.windGusts)} km/h</b>
                        </div>

                        <div>
                          <div style={{ fontSize: 10, color: 'var(--mute)' }}>
                            Reading time
                          </div>
                          <b style={{ fontSize: 11 }}>
                            {reading.time
                              ? new Date(reading.time).toLocaleTimeString(
                                  'en-IN',
                                  {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    timeZone: 'Asia/Kolkata',
                                  }
                                )
                              : '—'}
                          </b>
                        </div>
                      </div>
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
              padding: 16,
              border: '1px dashed var(--line)',
              borderRadius: 10,
            }}
          >
            <b>Live weather is unavailable.</b>
            <p className="note">
              Your simulated disruption scenarios are still available.
              Try refreshing the readings in a moment.
            </p>
          </div>
        )}

        <p className="note">
          {lastWeatherUpdate
            ? `Last API response: ${lastWeatherUpdate}. `
            : ''}
          Weather readings are current model-based observations or
          estimates, not confirmation of road closures. Risk badges use
          simple prototype thresholds for precipitation and wind gusts;
          they are not official warnings or validated transport predictions.
        </p>

        {weatherError && (
          <p className="note">{weatherError}</p>
        )}
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
                {chosenPath.nodes
                  .map(id => HUBS[id].name)
                  .join(' → ')}
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
                  chosenPath.nodes
                    .slice(1)
                    .reduce(
                      (sum, id, i) =>
                        sum +
                        haversineKm(
                          HUBS[chosenPath.nodes[i]],
                          HUBS[id]
                        ),
                      0
                    )
                )}{' '}
                km
