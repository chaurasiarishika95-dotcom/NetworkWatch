'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HUBS,
  LANES,
  SCENARIOS,
  buildPlan,
  findPath,
  getHubWeatherRisk,
  haversineKm,
} from '../lib/network';

const fmt = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmt1 = value => {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : '—';
};

function weatherSignal(reading) {
  if (!reading) return { label: 'No reading', tone: 'none' };
  const rain = reading.precipitation == null ? NaN : Number(reading.precipitation);
  const gust = reading.windGusts == null ? NaN : Number(reading.windGusts);
  if ((Number.isFinite(rain) && rain >= 20) || (Number.isFinite(gust) && gust >= 50)) return { label: 'High · modelled', tone: 'high' };
  if ((Number.isFinite(rain) && rain >= 10) || (Number.isFinite(gust) && gust >= 40)) return { label: 'Elevated · modelled', tone: 'elevated' };
  if ((Number.isFinite(rain) && rain >= 5) || (Number.isFinite(gust) && gust >= 30)) return { label: 'Watch · modelled', tone: 'watch' };
  return { label: 'Within prototype thresholds', tone: 'normal' };
}

function signalStyle(tone) {
  if (tone === 'high') return { color: '#a12626', background: '#fff0f0' };
  if (tone === 'elevated') return { color: '#8a5100', background: '#fff1d6' };
  if (tone === 'watch') return { color: '#805b00', background: '#fff8e8' };
  if (tone === 'normal') return { color: '#11765e', background: '#eaf7f1' };
  return { color: 'var(--mute)', background: 'var(--bg)' };
}

export default function Home() {
  const [scenario, setScenario] = useState('monsoon');
  const [plan, setPlan] = useState(() => buildPlan('monsoon'));
  const [weather, setWeather] = useState(null);
  const [weatherStatus, setWeatherStatus] = useState('Loading live weather…');
  const [weatherRefreshing, setWeatherRefreshing] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [origin, setOrigin] = useState('DEL');
  const [destination, setDestination] = useState('JAI');
  const [question, setQuestion] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [aiStatus, setAiStatus] = useState('Gemini status not tested');
  const [chatLoading, setChatLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [history, setHistory] = useState([]);
  const [roadRoute, setRoadRoute] = useState(null);
  const [roadLoading, setRoadLoading] = useState(false);

  // Independent live-weather refresh. Scenario simulations remain usable when this API is unavailable.
  const refreshWeather = useCallback(async () => {
    setWeatherRefreshing(true);
    try {
      const response = await fetch(`/api/weather?refresh=${Date.now()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Weather request failed');

      const readingCount = Object.keys(data.readings || {}).length;
      if (data.source === 'unavailable' || readingCount === 0) {
        setWeatherError(data.note || 'Live weather is temporarily unavailable.');
        setWeatherStatus('Weather unavailable; simulated scenarios remain available');
        return;
      }

      setWeather(data);
      setWeatherError('');
      setWeatherStatus(
        data.source === 'open-meteo'
          ? `Live Open-Meteo readings loaded (${readingCount}/${data.totalHubs || Object.keys(HUBS).length} hubs)`
          : `Partial Open-Meteo readings loaded (${readingCount}/${data.totalHubs || Object.keys(HUBS).length} hubs)`
      );
    } catch (error) {
      setWeatherError(error.message || 'Unable to refresh weather.');
      setWeatherStatus('Weather refresh failed; last readings retained if available');
    } finally {
      setWeatherRefreshing(false);
    }
  }, []);

  useEffect(() => { refreshWeather(); }, [refreshWeather]);

  // Whenever scenario or live weather changes, rebuild the network state used by map, routing and recovery plan.
  useEffect(() => {
    const hasLiveWeather = weather?.source === 'open-meteo' || weather?.source === 'open-meteo-partial';
    setPlan(buildPlan(scenario, hasLiveWeather ? weather.readings : null));
  }, [scenario, weather]);

  useEffect(() => {
    fetch('/api/scenarios')
      .then(response => response.json())
      .then(data => { if (data.scenarios) setHistory(data.scenarios); })
      .catch(() => {});
  }, []);

  const selected = SCENARIOS[scenario];
  const laneByKey = useMemo(() => Object.fromEntries(plan.lanes.map(lane => [lane.key, lane])), [plan]);
  const chosenPath = useMemo(() => findPath(origin, destination, plan.lanes), [origin, destination, plan]);
  const weatherReadings = weather?.readings || {};
  const weatherCount = Object.keys(weatherReadings).length;
  const hasLiveWeather = weather?.source === 'open-meteo' || weather?.source === 'open-meteo-partial';
  const impacted = plan.plans.filter(item => item.overflow > 0);
  const lastWeatherUpdate = weather?.fetchedAt
    ? new Date(weather.fetchedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  // Real-road preview follows the scenario/weather-aware graph path, leg by leg.
  useEffect(() => {
    let active = true;
    setRoadLoading(true);
    setRoadRoute(null);

    async function loadPath() {
      if (!chosenPath?.nodes?.length) {
        setRoadRoute({ source: 'unavailable', error: 'No feasible route exists under the selected scenario and lane conditions.' });
        setRoadLoading(false);
        return;
      }
      if (chosenPath.nodes.length === 1) {
        setRoadRoute({ source: 'OSRM / OpenStreetMap', trafficAvailable: false, distanceKm: 0, durationMinutes: 0, coordinates: [[HUBS[origin].lon, HUBS[origin].lat]], segments: [], trafficDelayMinutes: 0, note: 'Origin and destination are the same hub.' });
        setRoadLoading(false);
        return;
      }

      try {
        const legs = await Promise.all(chosenPath.nodes.slice(0, -1).map(async (from, index) => {
          const to = chosenPath.nodes[index + 1];
          const response = await fetch(`/api/road-route?origin=${from}&destination=${to}`, { cache: 'no-store' });
          const data = await response.json();
          if (!response.ok || !data.coordinates?.length) throw new Error(data.error || `Road routing failed for ${from} → ${to}`);
          return { ...data, from, to };
        }));

        const coordinates = [];
        for (const leg of legs) {
          const points = leg.coordinates || [];
          coordinates.push(...(coordinates.length ? points.slice(1) : points));
        }
        const sources = [...new Set(legs.map(leg => leg.source))];
        const trafficAvailable = legs.every(leg => leg.trafficAvailable === true);

        if (active) {
          setRoadRoute({
            source: sources.length === 1 ? sources[0] : 'Mixed routing providers',
            trafficAvailable,
            distanceKm: Math.round(legs.reduce((sum, leg) => sum + (leg.distanceKm || 0), 0) * 10) / 10,
            durationMinutes: legs.reduce((sum, leg) => sum + (leg.durationMinutes || 0), 0),
            trafficDelayMinutes: legs.every(leg => Number.isFinite(leg.trafficDelayMinutes))
              ? legs.reduce((sum, leg) => sum + leg.trafficDelayMinutes, 0)
              : null,
            noTrafficDurationMinutes: legs.every(leg => Number.isFinite(leg.noTrafficDurationMinutes))
              ? legs.reduce((sum, leg) => sum + leg.noTrafficDurationMinutes, 0)
              : null,
            coordinates,
            segments: legs.map(leg => ({
              from: leg.from,
              to: leg.to,
              distanceKm: leg.distanceKm,
              durationMinutes: leg.durationMinutes,
              trafficDelayMinutes: leg.trafficDelayMinutes ?? null,
              source: leg.source,
              trafficAvailable: leg.trafficAvailable,
            })),
            note: trafficAvailable
              ? 'TomTom traffic-aware routing is enabled for every leg. Travel time is an estimate, not a commercial-vehicle guarantee.'
              : 'Road geometry and baseline travel-time estimates come from OpenStreetMap/OSRM for legs without traffic data. Add TOMTOM_API_KEY in Vercel for traffic-aware estimates.',
          });
        }
      } catch (error) {
        if (active) setRoadRoute({ source: 'unavailable', error: error.message });
      } finally {
        if (active) setRoadLoading(false);
      }
    }

    loadPath();
    return () => { active = false; };
  }, [chosenPath, origin]);

  const roadLine = useMemo(() => {
    const points = roadRoute?.coordinates;
    if (!points?.length) return '';
    const lons = points.map(point => point[0]);
    const lats = points.map(point => point[1]);
    const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const dx = maxLon - minLon || 1; const dy = maxLat - minLat || 1;
    return points.map(([lon, lat]) => `${12 + ((lon - minLon) / dx) * 576},${188 - ((lat - minLat) / dy) * 160}`).join(' ');
  }, [roadRoute]);

  function chooseScenario(id) {
    setScenario(id);
    setChatMessages([]);
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
          weather,
          routeContext: { origin, destination, graphPath: chosenPath?.nodes || [], roadRoute },
          question: question || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setSaveMsg(data.persisted ? 'Saved to Supabase.' : 'Saved for this session only. Check Supabase environment variables.');
      if (data.scenarios) setHistory(data.scenarios);
    } catch (error) {
      setSaveMsg(`Could not save scenario: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function askCopilot() {
    const currentQuestion = question.trim();
    if (!currentQuestion || chatLoading) return;
    const nextMessages = [...chatMessages, { role: 'user', text: currentQuestion }];
    setChatMessages(nextMessages);
    setQuestion('');
    setChatLoading(true);
    setAiStatus('Contacting Gemini…');

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: currentQuestion,
          messages: chatMessages.slice(-10),
          scenario: selected.name,
          scenarioId: scenario,
          description: selected.description,
          plan,
          weather,
          routeContext: {
            origin: HUBS[origin].name,
            destination: HUBS[destination].name,
            graphPath: chosenPath?.nodes?.map(id => HUBS[id].name) || [],
            modelledHours: chosenPath?.hours ?? null,
            modelledCostPerParcel: chosenPath?.cost ?? null,
            roadDistanceKm: roadRoute?.distanceKm ?? null,
            roadDurationMinutes: roadRoute?.durationMinutes ?? null,
            trafficAvailable: roadRoute?.trafficAvailable ?? false,
            trafficDelayMinutes: roadRoute?.trafficDelayMinutes ?? null,
            routingSource: roadRoute?.source ?? null,
            routeStatus: roadRoute?.error ? 'unavailable' : roadRoute?.source ?? 'loading',
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Copilot request failed');
      setChatMessages([...nextMessages, { role: 'assistant', text: data.text || 'No response returned.', source: data.source }]);
      setAiStatus(data.source === 'Gemini' ? `Gemini connected · ${data.model || 'model'}` : 'Fallback mode · add GEMINI_API_KEY in Vercel');
    } catch (error) {
      setChatMessages([...nextMessages, { role: 'assistant', text: `The copilot request failed: ${error.message}. Check GEMINI_API_KEY and GEMINI_MODEL in Vercel, then review the function logs.`, source: 'error' }]);
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
          <p className="sub">Disruption intelligence and capacity-aware recovery planning for an illustrative North India parcel network.</p>
        </div>
        <div className="pill">Synthetic network · Not Delhivery operational data</div>
      </header>

      <section className="card banner">
        <b>Operating principle</b>
        <span>Detect disruption → quantify exposure → compare feasible routes → explain the trade-off → record the decision.</span>
      </section>

      <div className="layout">
        <section className="card mapcard">
          <div className="sectionhead">
            <div><div className="eyebrow">NETWORK OVERVIEW</div><h2>North India hub &amp; lane network</h2></div>
            <span className="live-dot">● {weatherStatus}</span>
          </div>
          <svg viewBox="0 0 800 390" role="img" aria-label="Schematic North India logistics hub network">
            <defs><pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="var(--line)" strokeWidth=".55" opacity=".6" /></pattern></defs>
            <rect width="800" height="390" fill="url(#grid)" rx="12" />
            {plan.lanes.map(lane => {
              const a = HUBS[lane.from]; const b = HUBS[lane.to]; const risk = lane.cut > 0;
              return <g key={lane.key}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lane.closed ? 'var(--bad)' : risk ? 'var(--warn)' : 'var(--ok)'} strokeWidth={risk ? 4 : 2.3} strokeDasharray={lane.closed ? '7 5' : undefined} opacity=".9"><title>{a.name} — {b.name}: {fmt(lane.effectiveCapacity)} parcels/day capacity; scenario impact {Math.round((lane.scenarioCut || 0) * 100)}%; weather impact {Math.round((lane.weatherCut || 0) * 100)}% (modelled)</title></line></g>;
            })}
            {Object.values(HUBS).map(hub => {
              const scenarioCut = selected.hubCuts?.[hub.id] || 0;
              const weatherRisk = getHubWeatherRisk(weatherReadings[hub.id]);
              const color = scenarioCut ? 'var(--bad)' : weatherRisk >= 0.12 ? 'var(--warn)' : 'var(--ink)';
              return <g key={hub.id}><circle cx={hub.x} cy={hub.y} r={hub.type === 'Gateway' ? 13 : 9} fill={scenarioCut ? 'var(--bad)' : 'var(--panel)'} stroke={color} strokeWidth="2.5"><title>{hub.name}; weather risk score {Math.round(weatherRisk * 100)}% (illustrative)</title></circle><text x={hub.x + 13} y={hub.y - 9} className="maplabel">{hub.name}</text></g>;
            })}
          </svg>
          <div className="legend"><span><i className="key ok" /> Available lane</span><span><i className="key warn" /> Capacity reduced / weather risk</span><span><i className="key bad" /> Closed / hub disruption</span></div>
          <p className="note">Hub-and-lane connections and operating capacity are synthetic. Live weather adds an illustrative lane-risk penalty; it does not verify road closures or road safety.</p>
        </section>

        <aside className="card controls">
          <div className="eyebrow">SCENARIO LAB</div>
          <h2>Choose a disruption</h2>
          <div className="scenario-list">{Object.entries(SCENARIOS).map(([id, item]) => <button key={id} className="scenario" aria-pressed={scenario === id} onClick={() => chooseScenario(id)}><b>{item.name}</b><small>{item.description}</small></button>)}</div>
          <div className="stats">
            <div><small>Affected lanes</small><strong>{plan.affectedLanes}</strong></div>
            <div><small>Capacity removed</small><strong>{fmt(plan.capacityLost)}</strong><small>parcels/day</small></div>
            <div><small>Potential overflow*</small><strong>{fmt(plan.atRisk)}</strong><small>parcels/day</small></div>
          </div>
          <p className="note">*Modelled exposure estimate, not a forecast. It is based on synthetic lane demand and capacity assumptions.</p>
          <button className="primary" onClick={saveScenario} disabled={saving}>{saving ? 'Saving…' : 'Save scenario & results'}</button>
          <p className="note">{saveMsg}</p>
        </aside>
      </div>

      <section className="card">
        <div className="sectionhead">
          <div><div className="eyebrow">LIVE WEATHER</div><h2>Current conditions across North India</h2><p className="sub">Independent of the selected simulated disruption. Weather risk feeds into the modelled plan when readings are available.</p></div>
          <button className="primary" type="button" onClick={refreshWeather} disabled={weatherRefreshing}>{weatherRefreshing ? 'Refreshing…' : 'Refresh weather'}</button>
        </div>
        <p className="note">{weatherStatus}{lastWeatherUpdate ? ` · API response: ${lastWeatherUpdate}` : ''}</p>
        {weatherCount > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))', gap: 12 }}>
            {Object.values(HUBS).map(hub => {
              const reading = weatherReadings[hub.id]; const signal = weatherSignal(reading); const badgeStyle = signalStyle(signal.tone);
              return <article key={hub.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: 'var(--bg)', minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}><div><b>{hub.name}</b><div style={{ color: 'var(--mute)', fontSize: 12 }}>{hub.city}</div></div></div>
                {reading ? <>
                  <div style={{ fontSize: 28, fontWeight: 800, margin: '12px 0' }}>{fmt1(reading.temperature)}°C</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                    <div><small>Precipitation</small><div><b>{fmt1(reading.precipitation)} mm</b></div></div>
                    <div><small>Wind speed</small><div><b>{fmt1(reading.windSpeed)} km/h</b></div></div>
                    <div><small>Wind gusts</small><div><b>{fmt1(reading.windGusts)} km/h</b></div></div>
                    <div><small>Reading time</small><div><b style={{ fontSize: 11 }}>{reading.time ? new Date(reading.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—'}</b></div></div>
                  </div>
                  <div style={{ marginTop: 12 }}><span className="pill" style={{ color: badgeStyle.color, background: badgeStyle.background, whiteSpace: 'normal' }}>{signal.label}</span></div>
                </> : <p className="note">No live reading available for this hub.</p>}
              </article>;
            })}
          </div>
        ) : <div style={{ padding: 16, border: '1px dashed var(--line)', borderRadius: 10 }}><b>Live weather is unavailable.</b><p className="note">The simulated scenarios are still available. Try refreshing the weather readings.</p></div>}
        <p className="note">Weather risk labels use prototype thresholds for precipitation and wind gusts. They are not official alerts or validated transport predictions.</p>
        {weatherError && <p className="note">{weatherError}</p>}
      </section>

      <section className="card">
        <div className="sectionhead"><div><div className="eyebrow">ROUTE EXPLORER</div><h2>Compare an origin–destination path</h2></div><span className="pill">Scenario + weather-aware graph path</span></div>
        <div className="routeform">
          <label>Origin<select value={origin} onChange={event => setOrigin(event.target.value)}>{Object.values(HUBS).map(hub => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
          <label>Destination<select value={destination} onChange={event => setDestination(event.target.value)}>{Object.values(HUBS).map(hub => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
        </div>
        {chosenPath ? <div className="route-result">
          <div><small>Recommended connected path</small><strong>{chosenPath.nodes.map(id => HUBS[id].name).join(' → ')}</strong></div>
          <div><small>Modelled transit</small><strong>{chosenPath.hours.toFixed(1)} h</strong></div>
          <div><small>Modelled cost</small><strong>₹{chosenPath.cost.toFixed(2)}/parcel</strong></div>
          <div><small>Approx. straight-line distance</small><strong>{fmt(chosenPath.nodes.slice(1).reduce((sum, id, index) => sum + haversineKm(HUBS[chosenPath.nodes[index]], HUBS[id]), 0))} km</strong></div>
        </div> : <p className="verdict">No feasible connected path under the selected lane conditions.</p>}

        <div className="road-route-panel">
          <div className="sectionhead"><div><div className="eyebrow">DISRUPTION-AWARE ROAD ROUTE</div><h2>Road route for the recommended recovery path</h2></div><span className="pill">{roadLoading ? 'Building multi-leg road route…' : roadRoute?.trafficAvailable ? 'Live traffic-aware routing' : roadRoute?.coordinates?.length ? 'Road geometry · baseline traffic' : 'Road routing unavailable'}</span></div>
          {roadRoute?.coordinates?.length > 1 ? <>
            <svg viewBox="0 0 600 205" role="img" aria-label="Road route geometry from a road-routing provider"><rect width="600" height="205" rx="10" fill="var(--bg)"/><polyline points={roadLine} fill="none" stroke="var(--ok)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
              {[[roadRoute.coordinates[0][0], roadRoute.coordinates[0][1], HUBS[origin].name], [roadRoute.coordinates[roadRoute.coordinates.length - 1][0], roadRoute.coordinates[roadRoute.coordinates.length - 1][1], HUBS[destination].name]].map((point, index) => {
                const coords = roadRoute.coordinates; const lons = coords.map(c => c[0]); const lats = coords.map(c => c[1]);
                const minLon = Math.min(...lons); const maxLon = Math.max(...lons); const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
                const x = 12 + ((point[0] - minLon) / (maxLon - minLon || 1)) * 576; const y = 188 - ((point[1] - minLat) / (maxLat - minLat || 1)) * 160;
                return <g key={index}><circle cx={x} cy={y} r="6" fill="var(--panel)" stroke="var(--ink)" strokeWidth="2"/><text x={Math.min(510, x + 8)} y={Math.max(16, y - 10)} className="maplabel">{point[2]}</text></g>;
              })}
            </svg>
            <div className="route-result road-metrics">
              <div><small>Road distance</small><strong>{fmt(roadRoute.distanceKm)} km</strong></div>
              <div><small>Estimated drive time</small><strong>{Math.floor(roadRoute.durationMinutes / 60)}h {roadRoute.durationMinutes % 60}m</strong></div>
              <div><small>Routing source</small><strong>{roadRoute.source || 'Road routing'}</strong></div>
            </div>
            {roadRoute.trafficAvailable && roadRoute.trafficDelayMinutes != null && <p className="note">Estimated traffic delay versus no-traffic conditions: {roadRoute.trafficDelayMinutes} minutes.</p>}
            <p className="note">{roadRoute.note}</p>
            {roadRoute.segments?.length > 1 && <p className="note">Road legs follow the recommended hub sequence: {roadRoute.segments.map(segment => `${HUBS[segment.from].name} → ${HUBS[segment.to].name}`).join(' · ')}.</p>}
          </> : <p className="note">{roadLoading ? 'Requesting road geometry…' : roadRoute?.error || 'Road route unavailable. The synthetic network graph remains available.'}</p>}
        </div>
        <p className="note">The graph path reacts to simulated lane closures and modelled weather risk. Road geometry and traffic are fetched separately for each selected leg. A simulated logistics-lane closure is not proof of a physical road closure.</p>
      </section>

      <section className="card">
        <div className="eyebrow">RECOVERY PLAN</div><h2>Where the plan needs attention</h2>
        {impacted.length ? <div className="tablewrap"><table><thead><tr><th>Affected lane</th><th>Total capacity cut</th><th>Weather component</th><th>Modelled overflow</th><th>Alternate path</th><th>Additional cost estimate</th></tr></thead><tbody>
          {impacted.map(item => <tr key={item.lane}><td>{HUBS[item.from].name} → {HUBS[item.to].name}</td><td>{Math.round((laneByKey[item.lane]?.cut || 0) * 100)}%</td><td>{Math.round((laneByKey[item.lane]?.weatherCut || 0) * 100)}%</td><td>{fmt(item.overflow)}</td><td>{item.alternative ? item.alternative.map(id => HUBS[id].name).join(' → ') : 'No feasible path'}</td><td>{item.extraCost == null ? '—' : `₹${fmt(item.extraCost)}`}</td></tr>)}
        </tbody></table></div> : <p className="verdict">No modelled lane overflow in this scenario. Try another disruption to stress-test the network.</p>}
        <p className="note">Volumes, capacities, risk penalties and costs are synthetic. The recovery paths are candidates, not a globally optimal multi-shipment allocation.</p>
      </section>

      <section className="card">
        <div className="sectionhead"><div><div className="eyebrow">AI OPERATIONS COPILOT</div><h2>Ask Network Watch</h2><p className="sub">Ask about the selected disruption, current weather, route, traffic estimate and recovery trade-offs. Gemini uses the latest displayed context.</p></div><span className="pill">{aiStatus}</span></div>
        <div className="prompts">{['Which lanes are most affected and why?', 'Compare the recovery route with the baseline.', 'How does current weather affect this plan?', 'What should I validate before approving the plan?'].map(prompt => <button key={prompt} className="chip" onClick={() => setQuestion(prompt)}>{prompt}</button>)}</div>
        {chatMessages.length > 0 && <div style={{ display: 'grid', gap: 10, margin: '12px 0' }}>
          {chatMessages.map((message, index) => <div key={`${index}-${message.role}`} className="answer" style={{ marginTop: 0, background: message.role === 'user' ? '#edf7f4' : 'var(--bg)' }}><b style={{ display: 'block', fontSize: 11, marginBottom: 5 }}>{message.role === 'user' ? 'You' : message.source === 'Gemini' ? 'Gemini · Network Watch' : 'Network Watch'}</b>{message.text}</div>)}
        </div>}
        <div className="askrow"><input value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askCopilot(); } }} placeholder="Ask about live weather, traffic, affected lanes…"/><button className="primary" onClick={askCopilot} disabled={chatLoading || !question.trim()}>{chatLoading ? 'Thinking…' : 'Ask Gemini'}</button></div>
        <p className="note">Gemini requires the server-side GEMINI_API_KEY in Vercel. Without it, the API returns a deterministic fallback explanation. Chat history is sent for context during this browser session.</p>
      </section>

      <section className="card">
        <div className="sectionhead"><div><div className="eyebrow">PERSISTENCE</div><h2>Saved scenario history</h2></div><span className="pill">Supabase</span></div>
        {history.length ? <div className="history">{history.map((item, index) => <div key={item.id || index}><b>{item.scenario_name || item.scenarioName || 'Scenario'}</b><span>{item.created_at ? new Date(item.created_at).toLocaleString() : item.generatedAt ? new Date(item.generatedAt).toLocaleString() : 'Saved in current session'}</span><small>{item.summary || `${item.affected_lanes ?? item.affectedLanes ?? 0} affected lanes`}</small></div>)}</div> : <p className="note">No saved scenarios yet. Saved scenarios will appear here when returned by the scenarios API.</p>}
      </section>

      <footer className="note">Portfolio prototype • Synthetic demand, capacities and costs • Weather is contextual and modelled risk does not establish road closure • Not affiliated with or using proprietary Delhivery data.</footer>
    </main>
  );
}
