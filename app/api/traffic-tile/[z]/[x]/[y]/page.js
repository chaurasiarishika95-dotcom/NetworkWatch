'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HUBS, SCENARIOS, getHubWeatherRisk, getLaneState } from '../lib/network';

/* ---------- small helpers ---------- */

const fmt = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmt1 = n => {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(1) : '—';
};
const duration = m => {
  if (m === null || m === undefined || !Number.isFinite(Number(m))) return '—';
  const total = Math.round(Number(m));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
};
const signed = m => (m > 0 ? `+${m}` : `${m}`);

// Same thresholds as lib/network.js getHubWeatherRisk (prototype heuristics, not official alerts).
function tone(risk) {
  if (risk >= 0.2) return { key: 'high', label: 'High' };
  if (risk >= 0.12) return { key: 'elevated', label: 'Elevated' };
  if (risk >= 0.05) return { key: 'watch', label: 'Watch' };
  return { key: 'clear', label: 'Clear' };
}

function hubTone(reading) {
  return reading ? tone(getHubWeatherRisk(reading)) : { key: 'none', label: 'No reading' };
}

const TONE_FILL = {
  high: '#c33c3c', elevated: '#d98b16', watch: '#e4b84a', clear: '#16806a', none: '#9aa9b1',
};

const JOURNEYS = [
  ['JAI', 'DEL'], ['DEL', 'VAR'], ['DEL', 'LKO'], ['CHD', 'AGR'],
];

/* ---------- decision text derived from the analysis (no invented numbers) ---------- */

function buildReasons(options) {
  const best = options[0];
  if (!best) return [];
  if (options.length === 1) {
    return ['This is the only connected path the modelled network offers for this journey right now.'];
  }
  const next = options[1];
  const reasons = [];
  const d = next.drivingMinutes - best.drivingMinutes;
  if (d >= 3) reasons.push(`${d} min less estimated driving time than ${next.hubNames.join(' → ')}.`);
  else if (d <= -3) reasons.push(`Not the quickest on the road: ${next.hubNames.join(' → ')} is ${-d} min faster, but it carries more modelled penalty.`);
  const w = next.weatherPenaltyMinutes - best.weatherPenaltyMinutes;
  if (w >= 2) reasons.push(`${w} min less modelled weather slowdown.`);
  const c = next.capacityPenaltyMinutes - best.capacityPenaltyMinutes;
  if (c >= 2) reasons.push(`${c} min less capacity-pressure penalty (${best.capacityPressureCount} vs ${next.capacityPressureCount} pressured legs).`);
  if (next.costDataAvailable && best.costDataAvailable && next.syntheticCostPerParcel != null && best.syntheticCostPerParcel != null) {
    const cost = next.syntheticCostPerParcel - best.syntheticCostPerParcel;
    if (cost >= 0.2) reasons.push(`₹${cost.toFixed(1)}/parcel lower using Supabase lane rates.`);
  }
  if (!reasons.length) reasons.push(`Narrowly ahead of ${next.hubNames.join(' → ')} (score ${best.score} vs ${next.score}); the options are close, so use judgement.`);
  return reasons;
}

function buildChecks(option, recommended, readings, scenarioId) {
  if (!option) return [];
  const checks = [];
  option.hubWeather.forEach(h => {
    const t = hubTone(h.reading);
    if (t.key === 'watch' || t.key === 'elevated' || t.key === 'high') {
      checks.push(`${t.label} weather signal at ${h.name} (${fmt1(h.reading.precipitation)} mm rain, ${fmt1(h.reading.windGusts)} km/h gusts). Confirm road and ground conditions with local teams.`);
    }
    if (!h.reading && readings && Object.keys(readings).length) checks.push(`No live weather reading for ${h.name}.`);
  });
  if (option.trafficCoveragePct < 100) {
    checks.push(option.trafficCoveragePct === 0
      ? 'No live traffic data on this journey (baseline road times only). Check a live traffic source before dispatch.'
      : `Live traffic covers only ${option.trafficCoveragePct}% of legs. Check the others manually.`);
  }
  if (option.trafficDelayMinutes >= 15) checks.push(`Provider reports about ${option.trafficDelayMinutes} min of traffic delay; consider moving the departure slot.`);
  option.segments.filter(s => s.estimatedOverflow > 0).forEach(s => {
    checks.push(`${s.fromName} → ${s.toName} is modelled over capacity (${fmt(s.estimatedOverflow)} parcels/day above effective capacity). Confirm vehicle and slot availability.`);
  });
  if (scenarioId !== 'baseline') checks.push(`A simulated "${SCENARIOS[scenarioId].name}" what-if is applied. It is not live data.`);
  const closedModelLanes = getLaneState(scenarioId, readings).filter(lane => lane.effectiveCapacity <= 0);
  if (closedModelLanes.length) {
    const closedNames = closedModelLanes.map(lane => `${HUBS[lane.from].name} → ${HUBS[lane.to].name}`);
    checks.push(`Modelled lanes fully unavailable in this scenario: ${closedNames.join('; ')}. The selected hub path should avoid these graph edges; this does not confirm real-road closures.`);
    if (option.segments.some(segment => closedModelLanes.some(lane => lane.key === segment.laneKey))) {
      checks.push('Warning: the selected path intersects a lane marked fully unavailable in the model. Do not use this route recommendation until the route analysis is corrected.');
    }
  }
  if (recommended && option.id !== recommended.id) {
    checks.push(`You are viewing an alternative: ${signed(option.drivingMinutes - recommended.drivingMinutes)} min drive time and ${signed(option.score - recommended.score)} score vs the recommendation.`);
  }
  if (!option.geometryAvailable) checks.push('Road geometry was unavailable for part of this path; the map shows straight hub-to-hub lines.');
  checks.push('Weather is read at hub coordinates, not along every kilometre of road. It does not confirm a road closure.');
  return checks;
}

/* ---------- map ---------- */

function decimate(points, max = 350) {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function trafficColor(segment) {
  if (!segment?.trafficAvailable) return '#84939b';
  const sections = segment.trafficSections || [];
  if (sections.some(section => section.severity === 'closure' || section.category === 'ROAD_CLOSURE')) return '#a91f2c';
  if (sections.some(section => section.severity === 'heavy')) return '#d7353e';
  if (sections.some(section => section.severity === 'moderate')) return '#ed7d21';
  if (sections.some(section => section.severity === 'slow')) return '#dfb323';

  const delay = Number(segment.trafficDelayMinutes);
  const ratio = Number(segment.trafficDelayRatio);
  if ((Number.isFinite(ratio) && ratio >= 0.30) || (Number.isFinite(delay) && delay >= 20)) return '#d7353e';
  if ((Number.isFinite(ratio) && ratio >= 0.15) || (Number.isFinite(delay) && delay >= 8)) return '#ed7d21';
  if ((Number.isFinite(ratio) && ratio >= 0.05) || (Number.isFinite(delay) && delay >= 3)) return '#dfb323';
  return '#16806a';
}

function sectionTrafficColor(section) {
  if (section?.severity === 'closure' || section?.category === 'ROAD_CLOSURE') return '#a91f2c';
  if (section?.severity === 'heavy') return '#d7353e';
  if (section?.severity === 'moderate') return '#ed7d21';
  if (section?.severity === 'slow' || section?.category === 'ROAD_WORK') return '#dfb323';
  return '#ed7d21';
}

function mercatorWorld([lon, lat], zoom) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  const worldSize = 256 * (2 ** zoom);
  return [
    ((lon + 180) / 360) * worldSize,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize,
  ];
}

function RouteMap({ options, selected, readings, onSelect }) {
  const W = 900;
  const H = 470;
  const pad = 44;
  const lines = options.map(option => {
    const points = option.geometryAvailable && option.coordinates?.length > 1
      ? option.coordinates
      : option.nodes.map(id => [HUBS[id].lon, HUBS[id].lat]);
    return { option, points: decimate(points, 600) };
  });
  const hubIds = [...new Set(options.flatMap(option => option.nodes))];
  const allPoints = [
    ...lines.flatMap(line => line.points),
    ...hubIds.map(id => [HUBS[id].lon, HUBS[id].lat]),
  ];

  let zoom = 5;
  for (let candidateZoom = 5; candidateZoom <= 14; candidateZoom += 1) {
    const projected = allPoints.map(point => mercatorWorld(point, candidateZoom));
    const xs = projected.map(point => point[0]);
    const ys = projected.map(point => point[1]);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX <= W - pad * 2 && spanY <= H - pad * 2) zoom = candidateZoom;
    else break;
  }

  const projected = allPoints.map(point => mercatorWorld(point, zoom));
  const minX = Math.min(...projected.map(point => point[0]));
  const maxX = Math.max(...projected.map(point => point[0]));
  const minY = Math.min(...projected.map(point => point[1]));
  const maxY = Math.max(...projected.map(point => point[1]));
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const offsetX = (W - spanX * scale) / 2;
  const offsetY = (H - spanY * scale) / 2;
  const px = point => {
    const [x, y] = mercatorWorld(point, zoom);
    return [offsetX + (x - minX) * scale, offsetY + (y - minY) * scale];
  };
  const path = points => points.map(point => px(point).map(value => value.toFixed(1)).join(',')).join(' ');

  // OpenStreetMap raster tiles provide the geographic context; colored overlays
  // below are derived from TomTom's live traffic sections when those are returned.
  const minTileX = Math.floor(minX / 256) - 1;
  const maxTileX = Math.floor(maxX / 256) + 1;
  const minTileY = Math.max(0, Math.floor(minY / 256) - 1);
  const maxTileY = Math.min((2 ** zoom) - 1, Math.floor(maxY / 256) + 1);
  const tiles = [];
  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const wrappedX = ((tileX % (2 ** zoom)) + (2 ** zoom)) % (2 ** zoom);
      tiles.push({
        key: `${zoom}/${wrappedX}/${tileY}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
        x: offsetX + (tileX * 256 - minX) * scale,
        y: offsetY + (tileY * 256 - minY) * scale,
        size: 256 * scale,
      });
    }
  }

  const onRoute = new Set(selected?.nodes || []);
  const selectedSegments = selected?.segments || [];
  const otherLines = lines.filter(line => line.option.id !== selected?.id);

  return (
    <div className="nw-mapwrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="OpenStreetMap road view with traffic conditions on the selected route" className="nw-map">
        <defs>
          <clipPath id="nw-map-clip"><rect width={W} height={H} rx="12" /></clipPath>
          <marker id="nw-route-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#123d4a" />
          </marker>
        </defs>
        <g clipPath="url(#nw-map-clip)">
          <rect width={W} height={H} fill="#e9eff0" />
          {tiles.map(tile => (
            <image
              key={tile.key}
              href={tile.url}
              x={tile.x}
              y={tile.y}
              width={tile.size}
              height={tile.size}
              preserveAspectRatio="none"
            />
          ))}
          {/* Broad live traffic-flow overlay from TomTom. This complements the route-specific
              traffic sections below; it is not a logistics-lane capacity signal. */}
          {tiles.map(tile => {
            const [tileZ, tileX, tileY] = tile.key.split('/');
            return (
              <image
                key={`traffic-${tile.key}`}
                href={`/api/traffic-tile/${tileZ}/${tileX}/${tileY}`}
                x={tile.x}
                y={tile.y}
                width={tile.size}
                height={tile.size}
                opacity="0.58"
                preserveAspectRatio="none"
              />
            );
          })}

          {otherLines.map(({ option, points }) => (
            <g key={option.id} onClick={() => onSelect(option.id)} style={{ cursor: 'pointer' }}>
              <polyline points={path(points)} fill="none" stroke="transparent" strokeWidth="18" />
              <polyline
                points={path(points)}
                fill="none"
                stroke="#647681"
                strokeWidth="4"
                strokeDasharray="8 7"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.76"
              >
                <title>Alternative: {option.hubNames.join(' → ')} · {duration(option.drivingMinutes)}</title>
              </polyline>
            </g>
          ))}

          {selectedSegments.map((segment, index) => {
            const points = segment.coordinates?.length > 1
              ? segment.coordinates
              : [[HUBS[segment.from].lon, HUBS[segment.from].lat], [HUBS[segment.to].lon, HUBS[segment.to].lat]];
            const baseColor = trafficColor(segment);
            const sections = segment.trafficSections || [];
            return (
              <g key={`${segment.laneKey}-${index}`}>
                <polyline points={path(points)} fill="none" stroke="white" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
                <polyline
                  points={path(points)}
                  fill="none"
                  stroke={baseColor}
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd={segment.trafficAvailable ? 'url(#nw-route-arrow)' : undefined}
                >
                  <title>
                    {segment.fromName} → {segment.toName}: {segment.trafficAvailable ? 'traffic-aware provider response' : 'no live traffic data'}{segment.trafficDelayMinutes == null ? '' : ` · ${segment.trafficDelayMinutes} min delay`}
                  </title>
                </polyline>
                {sections.map(section => (
                  <polyline
                    key={section.id}
                    points={path(section.coordinates || [])}
                    fill="none"
                    stroke={sectionTrafficColor(section)}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <title>
                      {section.category.replaceAll('_', ' ')}{section.delayMinutes == null ? '' : ` · ${section.delayMinutes} min incident delay`}{section.effectiveSpeedKmh == null ? '' : ` · ${section.effectiveSpeedKmh} km/h effective speed`}
                    </title>
                  </polyline>
                ))}
              </g>
            );
          })}

          {hubIds.map(id => {
            const [x, y] = px([HUBS[id].lon, HUBS[id].lat]);
            const reading = readings?.[id];
            const signal = hubTone(reading);
            const active = onRoute.has(id);
            const labelRight = x < W - 185;
            return (
              <g key={id}>
                <circle cx={x} cy={y} r={active ? 8 : 5} fill={TONE_FILL[signal.key]} stroke="#fff" strokeWidth="2.5" />
                <text x={labelRight ? x + 11 : x - 11} y={y - 9} textAnchor={labelRight ? 'start' : 'end'} className="maplabel">
                  {HUBS[id].name}
                </text>
                <title>
                  {HUBS[id].name}{active ? ' · on a candidate route' : ''}{reading
                    ? ` · ${fmt1(reading.temperature)}°C · precipitation ${fmt1(reading.precipitation)} mm · wind gusts ${fmt1(reading.windGusts)} km/h · modelled risk ${Math.round(getHubWeatherRisk(reading) * 100)}%`
                    : ' · no weather reading'}
                </title>
              </g>
            );
          })}
          <rect x={W - 226} y={H - 26} width="214" height="18" rx="4" fill="white" opacity="0.9" />
          <text x={W - 20} y={H - 13} textAnchor="end" fontSize="10" fill="#37474f">© OpenStreetMap contributors</text>
        </g>
      </svg>
    </div>
  );
}

function NetworkDiversionMap({ laneState, selected, readings }) {
  const laneStates = laneState || [];
  const chosenKeys = new Set(selected?.laneKeys || []);
  const closedLanes = laneStates.filter(lane => lane.effectiveCapacity <= 0);
  const W = 800;
  const H = 390;

  return (
    <div className="nw-diversion">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Modelled North India lane network highlighting the selected diversion and unavailable lanes" className="nw-network-map">
        <defs>
          <pattern id="nw-network-grid" width="25" height="25" patternUnits="userSpaceOnUse">
            <path d="M25 0 L0 0 0 25" fill="none" stroke="#e1e8eb" strokeWidth=".6" />
          </pattern>
          <marker id="nw-network-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#087f6b" />
          </marker>
        </defs>
        <rect width={W} height={H} rx="12" fill="url(#nw-network-grid)" />

        {laneStates.map(lane => {
          const a = HUBS[lane.from];
          const b = HUBS[lane.to];
          const isChosen = chosenKeys.has(lane.key);
          const stroke = lane.closed ? '#c33c3c' : lane.cut > 0 ? '#d98b16' : '#b8c5cb';
          return (
            <g key={lane.key}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={stroke}
                strokeWidth={isChosen ? 4 : lane.closed || lane.cut > 0 ? 2.8 : 1.7}
                strokeDasharray={lane.closed ? '8 6' : undefined}
                opacity={lane.closed || lane.cut > 0 ? 1 : 0.78}
              >
                <title>{lane.operationalDataAvailable
                  ? `${a.name} → ${b.name}: ${fmt(lane.currentVolume)} / ${fmt(lane.effectiveCapacity)} parcels/day current load / effective capacity (Supabase)${lane.closed ? ' · unavailable' : lane.cut > 0 ? ` · ${Math.round(lane.cut * 100)}% scenario/weather overlay` : ''}`
                  : `${a.name} → ${b.name}: operational capacity/load unavailable in Supabase${lane.closed ? ' · unavailable in selected what-if overlay' : lane.cut > 0 ? ` · ${Math.round(lane.cut * 100)}% modelled scenario/weather reduction` : ''}`}</title>
              </line>
            </g>
          );
        })}

        {selected?.segments?.map((segment, index) => {
          const a = HUBS[segment.from];
          const b = HUBS[segment.to];
          if (!a || !b) return null;
          const color = segment.effectiveCapacity < segment.modeledLaneCapacity ? '#d98b16' : '#087f6b';
          return (
            <line
              key={`${segment.laneKey}-${index}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={color} strokeWidth="5" strokeLinecap="round"
              markerEnd="url(#nw-network-arrow)"
            >
              <title>Selected diversion: {segment.fromName} → {segment.toName}</title>
            </line>
          );
        })}

        {Object.values(HUBS).map(hub => {
          const onRoute = selected?.nodes?.includes(hub.id);
          const reading = readings?.[hub.id];
          const fill = onRoute ? '#e8f7f1' : '#fff';
          return (
            <g key={hub.id}>
              <circle cx={hub.x} cy={hub.y} r={hub.type === 'Gateway' ? 12 : 8.5} fill={fill} stroke={onRoute ? '#087f6b' : '#526570'} strokeWidth={onRoute ? 3 : 2} />
              <text x={hub.x + 12} y={hub.y - 8} className="nw-network-label">{hub.name}</text>
              <title>
                {hub.name}{onRoute ? ' · selected route' : ''}{reading
                  ? ` · precipitation ${fmt1(reading.precipitation)} mm · wind gusts ${fmt1(reading.windGusts)} km/h · weather risk ${Math.round(getHubWeatherRisk(reading) * 100)}% (modelled)`
                  : ' · no live weather reading'}
              </title>
            </g>
          );
        })}
      </svg>

      <div className="legend">
        <span><i className="key" style={{ background: '#087f6b' }} /> Selected recovery path</span>
        <span><i className="key" style={{ background: '#b8c5cb' }} /> Available modelled lane</span>
        <span><i className="key" style={{ background: '#d98b16' }} /> Capacity reduced</span>
        <span><i className="key" style={{ background: '#c33c3c' }} /> Fully lost lane (dashed)</span>
      </div>

      <p className="note">
        {closedLanes.length
          ? `Unavailable lanes on the current map: ${closedLanes.map(lane => `${HUBS[lane.from].name} → ${HUBS[lane.to].name}`).join('; ')}. These reflect scenario overlays and/or imported Supabase lane status. The selected path is highlighted separately.`
          : 'No lane is fully unavailable under this condition set. Orange links show scenario/weather overlays; green arrows show the selected route through the network.'}
      </p>
    </div>
  );
}

/* ---------- page ---------- */

export default function Home() {
  const [origin, setOrigin] = useState('JAI');
  const [destination, setDestination] = useState('DEL');
  const [scenario, setScenario] = useState('baseline');
  const [parcelVolume, setParcelVolume] = useState('1000');

  const [weather, setWeather] = useState(null);
  const [weatherAttempted, setWeatherAttempted] = useState(false);
  const [weatherRefreshing, setWeatherRefreshing] = useState(false);
  const [weatherError, setWeatherError] = useState('');

  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [recoveryAnalysis, setRecoveryAnalysis] = useState(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryPlanId, setRecoveryPlanId] = useState(null);

  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [aiSource, setAiSource] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [history, setHistory] = useState([]);

  /* live weather: on load, then every 5 minutes */
  const refreshWeather = useCallback(async () => {
    setWeatherRefreshing(true);
    try {
      const response = await fetch(`/api/weather?refresh=${Date.now()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Weather request failed');
      if (data.source === 'unavailable' || !Object.keys(data.readings || {}).length) {
        setWeatherError(data.note || 'Live weather is temporarily unavailable.');
      } else {
        setWeather(data);
        setWeatherError(data.source === 'open-meteo-partial' ? 'Some hubs have no live reading right now.' : '');
      }
    } catch (error) {
      setWeatherError(error.message || 'Unable to refresh weather.');
    } finally {
      setWeatherRefreshing(false);
      setWeatherAttempted(true);
    }
  }, []);

  useEffect(() => {
    refreshWeather();
    const timer = setInterval(refreshWeather, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshWeather]);

  useEffect(() => {
    fetch('/api/scenarios')
      .then(r => r.json())
      .then(d => { if (d.scenarios) setHistory(d.scenarios); })
      .catch(() => {});
  }, []);

  /* route analysis: re-runs whenever the journey, what-if or live weather changes */
  const hasWeather = Boolean(weather?.readings && Object.keys(weather.readings).length);
  useEffect(() => {
    if (!weatherAttempted) return undefined;
    if (origin === destination) { setAnalysis(null); setAnalysisError(''); return undefined; }

    const controller = new AbortController();
    setAnalysisLoading(true);
    setAnalysisError('');
    fetch('/api/route-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        origin,
        destination,
        scenario,
        weatherReadings: hasWeather ? weather.readings : null,
        weatherSource: weather?.source || 'unavailable',
        weatherFetchedAt: weather?.fetchedAt || null,
      }),
    })
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || data.error || 'Route analysis failed');
        setAnalysis(data);
      })
      .catch(error => {
        if (error.name === 'AbortError') return;
        setAnalysis(null);
        setAnalysisError(error.message || 'Route analysis failed');
      })
      .finally(() => { if (!controller.signal.aborted) setAnalysisLoading(false); });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, scenario, weatherAttempted, weather?.fetchedAt]);

  // Real recovery planning is deliberately backed by Supabase operational rows.
  // If those tables/orders are not populated, the API returns a setup checklist instead of invented counts.
  useEffect(() => {
    if (!weatherAttempted || origin === destination) return undefined;
    const controller = new AbortController();
    setRecoveryLoading(true);
    setRecoveryError('');
    fetch('/api/recovery-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      body: JSON.stringify({
        origin,
        destination,
        scenario,
        weatherReadings: hasWeather ? weather?.readings : null,
        weatherSource: weather?.source || 'unavailable',
        trafficLegs: analysis?.origin === origin && analysis?.destination === destination
          ? analysis.options.flatMap(option => option.segments.map(segment => ({
              laneKey: segment.laneKey,
              from: segment.from,
              to: segment.to,
              durationMinutes: segment.durationMinutes,
              trafficAvailable: segment.trafficAvailable,
              trafficDelayMinutes: segment.trafficDelayMinutes,
              source: segment.source,
            })))
          : [],
      }),
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || data.error || 'Recovery planning failed');
        return data;
      })
      .then(data => {
        setRecoveryAnalysis(data);
        setRecoveryPlanId(data.recommendedPlan?.id || data.plans?.[0]?.id || null);
      })
      .catch(error => {
        if (error.name === 'AbortError') return;
        setRecoveryAnalysis(null);
        setRecoveryError(error.message || 'Could not load recovery plan.');
      })
      .finally(() => { if (!controller.signal.aborted) setRecoveryLoading(false); });
    return () => controller.abort();
  }, [origin, destination, scenario, weatherAttempted, weather?.fetchedAt, analysis?.origin, analysis?.destination, analysis?.generatedAt]);

  /* derived journey state */
  const current = analysis && analysis.origin === origin && analysis.destination === destination ? analysis : null;
  const options = current?.options || [];
  const recommended = options.find(o => o.isRecommended) || options[0] || null;
  const selected = options.find(o => o.id === selectedId) || recommended;
  const readings = weather?.readings || {};
  // Scenario/weather overlays describe the configured topology. When Supabase lane
  // records are available, show their actual capacities and current loads on the map.
  const scenarioLaneState = useMemo(
    () => getLaneState(scenario, hasWeather ? readings : null),
    [scenario, hasWeather, weather?.fetchedAt]
  );
  const networkLaneState = useMemo(() => {
    const dbByKey = new Map((recoveryAnalysis?.ready ? recoveryAnalysis.laneState || [] : []).map(lane => [lane.key, lane]));
    return scenarioLaneState.map(lane => {
      const db = dbByKey.get(lane.key);
      if (!db) return { ...lane, operationalDataAvailable: false, modeledCapacity: lane.capacity };
      return {
        ...lane,
        capacity: db.baseCapacity,
        effectiveCapacity: db.effectiveCapacity,
        currentVolume: db.currentVolume,
        spare: db.spare,
        gap: db.gap,
        costPerParcel: db.costPerParcelINR,
        operationalDataAvailable: db.operationalDataAvailable === true,
        closed: lane.closed || db.isClosed,
      };
    });
  }, [scenarioLaneState, recoveryAnalysis]);
  const closedModelLanes = scenarioLaneState.filter(lane => lane.effectiveCapacity <= 0);
  const reducedModelLanes = scenarioLaneState.filter(lane => lane.effectiveCapacity > 0 && lane.cut > 0);
  const plannedParcels = Math.max(1, Math.min(1000000, Math.round(Number(parcelVolume) || 1)));
  const pricedOptions = options.filter(option => option.costDataAvailable && Number.isFinite(Number(option.syntheticCostPerParcel)));
  const cheapestOption = pricedOptions.length ? [...pricedOptions].sort((a, b) => a.syntheticCostPerParcel - b.syntheticCostPerParcel)[0] : null;
  const selectedTotalCost = selected?.costDataAvailable ? Math.round(selected.syntheticCostPerParcel * plannedParcels) : null;
  const recommendedTotalCost = recommended?.costDataAvailable ? Math.round(recommended.syntheticCostPerParcel * plannedParcels) : null;
  const cheapestTotalCost = cheapestOption ? Math.round(cheapestOption.syntheticCostPerParcel * plannedParcels) : null;
  const recoveryPlans = recoveryAnalysis?.plans || [];
  const selectedRecoveryPlan = recoveryPlans.find(plan => plan.id === recoveryPlanId) || recoveryAnalysis?.recommendedPlan || null;
  const recommendedRecoveryPlan = recoveryAnalysis?.recommendedPlan || recoveryPlans[0] || null;

  const routeWeather = useMemo(() => {
    if (!selected) return null;
    const subset = {};
    selected.nodes.forEach(id => { if (readings[id]) subset[id] = readings[id]; });
    return { source: weather?.source || 'unavailable', fetchedAt: weather?.fetchedAt || null, note: weather?.note || null, readings: subset };
  }, [selected, readings, weather]);

  const reasons = useMemo(() => buildReasons(options), [options]);
  const checks = useMemo(() => buildChecks(selected, recommended, readings, scenario), [selected, recommended, readings, scenario]);

  const fastest = options.length ? options.reduce((a, b) => (a.drivingMinutes <= b.drivingMinutes ? a : b)) : null;
  const weatherAlerts = selected
    ? selected.hubWeather.filter(h => ['watch', 'elevated', 'high'].includes(hubTone(h.reading).key))
    : [];
  const anyWeatherOnCandidates = options.some(o => o.hubWeather.some(h => ['watch', 'elevated', 'high'].includes(hubTone(h.reading).key)));

  const journeyPlan = useMemo(() => {
    if (!selected) return null;
    const segs = selected.segments;
    return {
      scenario,
      scenarioName: SCENARIOS[scenario].name,
      affectedLanes: segs.filter(s => s.weatherCut > 0 || s.scenarioCut > 0 || (s.estimatedOverflow != null && s.estimatedOverflow > 0)).length,
      capacityLost: segs.every(s => s.modeledLaneCapacity != null && s.effectiveCapacity != null)
        ? segs.reduce((sum, s) => sum + Math.max(0, s.modeledLaneCapacity - s.effectiveCapacity), 0)
        : null,
      atRisk: selected.estimatedOverflowParcelsPerDay,
      weatherIntegrated: Object.keys(routeWeather?.readings || {}).length > 0,
      weatherHubsUsed: Object.keys(routeWeather?.readings || {}).length,
      plans: segs.filter(s => s.estimatedOverflow > 0).map(s => ({
        lane: s.laneKey, from: s.from, to: s.to, overflow: s.estimatedOverflow,
        alternative: null, extraCost: null, status: 'Capacity pressure on the selected journey',
        weatherCapacityCut: s.weatherCut,
      })),
      lanes: segs.map(s => ({
        key: s.laneKey,
        cut: s.modeledLaneCapacity ? 1 - s.effectiveCapacity / s.modeledLaneCapacity : 0,
        scenarioCut: s.scenarioCut, weatherCut: s.weatherCut,
        effectiveCapacity: s.effectiveCapacity, closed: s.effectiveCapacity <= 0,
      })),
      // Do not persist the static illustrative hub capacity/demand as operational facts.
      activeHubs: selected.nodes.map(id => ({
        id, name: HUBS[id].name, capacity: null, demand: null,
        weatherRisk: getHubWeatherRisk(readings[id]),
      })),
    };
  }, [selected, scenario, routeWeather, readings]);

  const routeContext = useMemo(() => {
    if (!selected || !recommended) return null;
    return {
      origin, destination,
      originName: HUBS[origin].name,
      destinationName: HUBS[destination].name,
      recommendedPath: recommended.hubNames,
      selectedPath: selected.hubNames,
      selectedIsRecommended: selected.id === recommended.id,
      routeStatus: selected.id === recommended.id ? 'recommended route' : 'user-selected alternative',
      operationalCostPerParcelINR: selected.costDataAvailable ? selected.syntheticCostPerParcel : null,
      costSource: selected.costSource || null,
      costDataAvailable: Boolean(selected.costDataAvailable),
      plannedParcelVolume: plannedParcels,
      estimatedTotalTransportCostINR: selectedTotalCost,
      roadDistanceKm: selected.distanceKm,
      roadDurationMinutes: selected.drivingMinutes,
      routingSource: selected.source,
      trafficAvailable: selected.trafficAvailable,
      trafficCoveragePct: selected.trafficCoveragePct,
      trafficDelayMinutes: selected.trafficDelayMinutes,
      weatherStatus: selected.weatherStatus,
      capacityPressureCount: selected.capacityPressureCount,
      scoreParts: selected.scoreParts,
      networkInterventions: {
        fullyUnavailableLanes: closedModelLanes.map(lane => ({
          key: lane.key, from: lane.from, to: lane.to,
          fromName: HUBS[lane.from].name, toName: HUBS[lane.to].name,
        })),
        capacityReducedLanes: reducedModelLanes.map(lane => ({
          key: lane.key, fromName: HUBS[lane.from].name, toName: HUBS[lane.to].name,
          capacityCutPct: Math.round(lane.cut * 100),
        })).slice(0, 12),
        selectedPathAvoidsFullyUnavailableLanes: selected.segments.every(segment =>
          !closedModelLanes.some(lane => lane.key === segment.laneKey)
        ),
      },
      checks,
      legs: selected.segments.map(s => ({
        leg: `${s.fromName} → ${s.toName}`,
        distanceKm: s.distanceKm, durationMinutes: s.durationMinutes,
        trafficDelayMinutes: s.trafficDelayMinutes, trafficAvailable: s.trafficAvailable,
        trafficSeverity: s.trafficSeverity || 'unknown',
        trafficIncidentCount: s.trafficIncidentCount || 0,
        trafficSections: (s.trafficSections || []).map(section => ({ category: section.category, severity: section.severity, delayMinutes: section.delayMinutes, effectiveSpeedKmh: section.effectiveSpeedKmh })),
        weatherCapacityCutPct: Math.round((s.weatherCut || 0) * 100),
        weatherSlowdownMinutes: s.weatherPenaltyMinutes,
        estimatedOverflowParcelsPerDay: s.estimatedOverflow,
        source: s.source,
      })),
      candidateOptions: options.map(o => ({
        path: o.hubNames, distanceKm: o.distanceKm, drivingMinutes: o.drivingMinutes,
        trafficCoveragePct: o.trafficCoveragePct, trafficDelayMinutes: o.trafficDelayMinutes,
        maxWeatherRiskPct: o.maxWeatherRiskPct, capacityPressureCount: o.capacityPressureCount,
        operationalCostPerParcelINR: o.costDataAvailable ? o.syntheticCostPerParcel : null,
        costDataAvailable: Boolean(o.costDataAvailable),
        estimatedTotalTransportCostINR: o.costDataAvailable ? Math.round(o.syntheticCostPerParcel * plannedParcels) : null,
        trafficSeverity: o.trafficSeverity, trafficIncidentCount: o.trafficIncidentCount, trafficLengthKm: o.trafficLengthKm,
        weatherPenaltyMinutes: o.weatherPenaltyMinutes, capacityPenaltyMinutes: o.capacityPenaltyMinutes,
        score: o.score, recommended: o.id === recommended.id, selected: o.id === selected.id,
      })),
      recoveryPlan: selectedRecoveryPlan ? {
        source: recoveryAnalysis?.source || null,
        ready: recoveryAnalysis?.ready || false,
        actions: selectedRecoveryPlan.actions || [],
        overCapacityParcelsPerDay: selectedRecoveryPlan.overCapacityParcelsPerDay ?? null,
        divertedParcelsPerDay: selectedRecoveryPlan.divertedParcelsPerDay ?? null,
        temporaryCapacityUsedParcelsPerDay: selectedRecoveryPlan.temporaryCapacityUsedParcelsPerDay ?? null,
        promisesAdjustedParcels: selectedRecoveryPlan.promisesAdjustedParcels ?? null,
        projectedOnTimeParcels: selectedRecoveryPlan.projectedOnTimeParcels ?? null,
        projectedLateParcels: selectedRecoveryPlan.projectedLateParcels ?? null,
        operationalCostINR: selectedRecoveryPlan.operationalCostINR ?? null,
        diversions: (selectedRecoveryPlan.diversions || []).slice(0, 10),
        notes: selectedRecoveryPlan.notes || [],
      } : null,
    };
  }, [selected, recommended, options, origin, destination, checks, plannedParcels, selectedTotalCost, closedModelLanes, reducedModelLanes, selectedRecoveryPlan, recoveryAnalysis]);

  /* actions */
  function resetJourneyState() {
    setSelectedId(null);
    setMessages([]);
    setSaveMsg('');
  }
  function changeOrigin(id) { setOrigin(id); resetJourneyState(); }
  function changeDestination(id) { setDestination(id); resetJourneyState(); }
  function swap() { setOrigin(destination); setDestination(origin); resetJourneyState(); }
  function changeScenario(id) { setScenario(id); resetJourneyState(); }
  function pickJourney([o, d]) { setOrigin(o); setDestination(d); resetJourneyState(); }
  function chooseOption(id) { setSelectedId(id); setMessages([]); setSaveMsg(''); }
  function toggleRecoveryAction(actionKey, checked) {
    if (!recoveryAnalysis?.ready) return;
    const base = selectedRecoveryPlan?.actions || recommendedRecoveryPlan?.actions || [];
    const next = checked ? [...new Set([...base, actionKey])] : base.filter(key => key !== actionKey);
    const optionId = [...next].sort().join('+') || 'none';
    if (recoveryPlans.some(plan => plan.id === optionId)) setRecoveryPlanId(optionId);
  }
  function useRecommendedRecoveryPlan() {
    if (recommendedRecoveryPlan) setRecoveryPlanId(recommendedRecoveryPlan.id);
  }

  async function askCopilot(text) {
    const q = String(text ?? question).trim();
    if (!q || !routeContext || chatLoading) return;
    const prior = messages;
    setQuestion('');
    setMessages([...prior, { role: 'user', text: q }]);
    setChatLoading(true);
    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          messages: prior,
          scenario: SCENARIOS[scenario].name,
          scenarioId: scenario,
          description: SCENARIOS[scenario].description,
          plan: journeyPlan,
          recoveryPlan: selectedRecoveryPlan ? { ...selectedRecoveryPlan, ready: recoveryAnalysis?.ready === true, source: recoveryAnalysis?.source || null, planningBasis: recoveryAnalysis?.note || null } : { ready: recoveryAnalysis?.ready === true, missingRequirements: recoveryAnalysis?.missingRequirements || [] },
          operationalData: recoveryAnalysis ? { ready: recoveryAnalysis.ready, source: recoveryAnalysis.source, counts: recoveryAnalysis.counts, missingRequirements: recoveryAnalysis.missingRequirements } : null,
          weather: routeWeather,
          routeContext,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || 'Copilot request failed');
      setAiSource(data.source === 'Gemini' ? `Gemini (${data.model})` : 'Built-in fallback (no Gemini key)');
      setMessages(m => [...m, { role: 'assistant', text: data.text || 'No response.' }]);
    } catch (error) {
      setMessages(m => [...m, { role: 'assistant', text: `Copilot unavailable: ${error.message}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function saveJourney() {
    if (!routeContext) return;
    setSaving(true);
    setSaveMsg('Saving…');
    try {
      const lastQuestion = [...messages].reverse().find(m => m.role === 'user')?.text || null;
      const response = await fetch('/api/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario, plan: journeyPlan, question: lastQuestion, weather: routeWeather, recoveryPlan: selectedRecoveryPlan ? { ...selectedRecoveryPlan, ready: recoveryAnalysis?.ready === true, source: recoveryAnalysis?.source || null, planningBasis: recoveryAnalysis?.note || null } : null, operationalData: recoveryAnalysis ? { ready: recoveryAnalysis.ready, source: recoveryAnalysis.source, counts: recoveryAnalysis.counts, missingRequirements: recoveryAnalysis.missingRequirements } : null, routeContext: { ...routeContext, plannedParcelVolume: plannedParcels, estimatedTotalTransportCostINR: selectedTotalCost } }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed');
      setSaveMsg(data.persisted ? 'Saved to Supabase.' : 'Saved for this session only. Check Supabase environment variables.');
      if (data.scenarios) setHistory(data.scenarios);
    } catch (error) {
      setSaveMsg(`Could not save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  /* status chips */
  const weatherUpdated = weather?.fetchedAt
    ? new Date(weather.fetchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : null;
  const trafficChip = !selected
    ? 'Traffic: —'
    : selected.trafficCoveragePct === 100
      ? 'Traffic: live on every leg'
      : selected.trafficCoveragePct > 0
        ? `Traffic: live on ${selected.trafficCoveragePct}% of legs`
        : 'Traffic: not live (baseline road times)';

  const maxScore = Math.max(1, ...options.map(o => o.score));
  const prompts = recommended ? [
    `Why is ${recommended.hubNames.join(' → ')} recommended?`,
    'Which weather should I watch along this route, and when would you switch routes?',
    'What should I check before dispatching on this journey?',
  ] : [];

  return (
    <main>
      <header className="hero">
        <div>
          <div className="eyebrow">INDIA LOGISTICS • JOURNEY DECISION SUPPORT PROTOTYPE</div>
          <h1>Network Watch</h1>
          <p className="sub">Choose a journey and scenario. Network Watch compares live road-time signals, corridor weather and lane capacity, then recommends a recovery path with visible traffic conditions and estimated cost.</p>
        </div>
        <div className="pill">Illustrative North India hub topology · Not Delhivery operational data</div>
      </header>

      {/* 1 — choose a journey */}
      <section className="card nw-step">
        <div className="nw-stephead"><span className="nw-num">1</span><div><div className="eyebrow">CHOOSE A JOURNEY</div><h2>Where is the load going?</h2></div></div>

        <div className="nw-journeybar">
          <label>Origin
            <select value={origin} onChange={e => changeOrigin(e.target.value)}>
              {Object.values(HUBS).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <button type="button" className="chip nw-swap" onClick={swap} aria-label="Swap origin and destination">⇄</button>
          <label>Destination
            <select value={destination} onChange={e => changeDestination(e.target.value)}>
              {Object.values(HUBS).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <label>Conditions
            <select value={scenario} onChange={e => changeScenario(e.target.value)}>
              {Object.entries(SCENARIOS).map(([id, s]) => <option key={id} value={id}>{id === 'baseline' ? 'Live conditions only' : `What-if: ${s.name}`}</option>)}
            </select>
          </label>
          <label>Manual route-cost comparison volume (not order data)
            <input className="nw-input" type="number" min="1" max="1000000" step="100" value={parcelVolume} onChange={e => setParcelVolume(e.target.value)} />
          </label>
        </div>

        <div className="prompts">
          {JOURNEYS.map(j => (
            <button key={j.join()} type="button" className="chip" onClick={() => pickJourney(j)}>{HUBS[j[0]].name} → {HUBS[j[1]].name}</button>
          ))}
        </div>

        <div className="nw-chips">
          <span className="pill">Weather: {hasWeather ? `Open-Meteo · ${weatherUpdated}` : weatherAttempted ? 'unavailable' : 'loading…'}</span>
          <span className="pill">{trafficChip}</span>
          <span className="pill">{scenario === 'baseline' ? 'No simulated disruption applied' : `Simulated: ${SCENARIOS[scenario].name}`}</span>
          <button type="button" className="chip" onClick={refreshWeather} disabled={weatherRefreshing}>{weatherRefreshing ? 'Refreshing…' : 'Refresh now'}</button>
          <span className="note" style={{ margin: 0 }}>Weather auto-refreshes every 5 min; traffic refreshes during route analysis.</span>
        </div>
        {weatherError && <p className="note">{weatherError}</p>}
        {scenario !== 'baseline' && <p className="note">{SCENARIOS[scenario].description} This is a what-if overlay, not live data.</p>}
      </section>

      {origin === destination && <section className="card"><p className="verdict">Choose two different hubs to compare routes.</p></section>}
      {analysisError && <section className="card"><p className="verdict">Could not analyse this journey: {analysisError}</p></section>}
      {origin !== destination && !current && !analysisError && <section className="card"><p className="note" style={{ margin: 0 }}>{analysisLoading || !weatherAttempted ? 'Reading live weather and road times for this journey…' : 'No analysis yet.'}</p></section>}
      {current && !options.length && <section className="card"><p className="verdict">{current.message || 'No connected path is available for this journey under the current conditions.'}</p></section>}

      {current && options.length > 0 && selected && (
        <>
          {/* alert strip */}
          <section className={`card nw-alert ${anyWeatherOnCandidates ? 'warn' : 'ok'}`}>
            <b>{anyWeatherOnCandidates ? 'Weather is affecting this corridor' : 'No weather flags on this corridor'}</b>
            <span>
              {anyWeatherOnCandidates
                ? `${[...new Set(options.flatMap(o => o.hubWeather.filter(h => ['watch', 'elevated', 'high'].includes(hubTone(h.reading).key)).map(h => h.name)))].join(', ')} crosses the prototype rain/wind thresholds. ${fastest && recommended && fastest.id !== recommended.id ? `${fastest.hubNames.join(' → ')} is quicker on the road (${duration(fastest.drivingMinutes)}), but ${recommended.hubNames.join(' → ')} is recommended after weather and capacity penalties.` : 'Ranking below already includes the weather slowdown.'}`
                : 'No hub on any candidate path currently crosses the prototype rain/wind thresholds, so ranking is driven by drive time, capacity pressure and cost.'}
              {analysisLoading ? ' Updating…' : ''}
            </span>
          </section>

          {/* 2 — compare options */}
          <section className="card nw-step">
            <div className="nw-stephead"><span className="nw-num">2</span><div><div className="eyebrow">COMPARE ROUTE OPTIONS</div><h2>{HUBS[origin].name} → {HUBS[destination].name}: {options.length} candidate path{options.length > 1 ? 's' : ''}</h2></div></div>
            {recommended && (
              <div className="nw-recommendation">
                <div className="nw-recommendation-copy">
                  <div className="eyebrow">RECOMMENDED RECOVERY SOLUTION</div>
                  <h3>{recommended.hubNames.join(' → ')}</h3>
                  <p>
                    Best-ranked candidate for {HUBS[origin].name} → {HUBS[destination].name}
                    {' '}under <b>{SCENARIOS[scenario].name}</b>, after comparing road time,
                    traffic signals where available, route-hub weather and modelled lane capacity.
                  </p>
                </div>
                <div className="nw-recommendation-metrics">
                  <div><small>Estimated road time</small><strong>{duration(recommended.drivingMinutes)}</strong></div>
                  <div><small>Road distance</small><strong>{fmt(recommended.distanceKm)} km</strong></div>
                  <div><small>Transport cost per parcel</small><strong>{recommended.costDataAvailable ? `₹${recommended.syntheticCostPerParcel.toFixed(2)}` : 'Unavailable in Supabase'}</strong></div>
                  <div><small>Cost for {fmt(plannedParcels)} manually specified parcels</small><strong>{recommendedTotalCost == null ? 'Unavailable' : `₹${fmt(recommendedTotalCost)}`}</strong></div>
                  <div><small>Live traffic coverage</small><strong>{recommended.trafficCoveragePct}%</strong></div>
                  <div><small>Reported traffic incidents</small><strong>{recommended.trafficIncidentCount || 0}</strong></div>
                </div>
                <div className="nw-recommendation-footer">
                  <span>
                    {!recommended.costDataAvailable
                      ? 'Transport costs are not ranked until actual lane cost rows are loaded into Supabase.'
                      : cheapestOption && cheapestOption.id !== recommended.id
                        ? `₹${fmt(recommendedTotalCost - cheapestTotalCost)} above the lowest-cost evaluated candidate for this manually specified volume.`
                        : 'Lowest actual Supabase lane-rate cost among evaluated candidates.'}
                    {' '}Estimated route cost uses per-lane rates; it is not a carrier quote.
                  </span>
                  <button className="primary" type="button" onClick={() => chooseOption(recommended.id)} disabled={selected?.id === recommended.id}>
                    {selected?.id === recommended.id ? 'Recommended route selected' : 'Apply recommended route'}
                  </button>
                </div>
              </div>
            )}
            <div className="nw-options">
              {options.map((o, i) => {
                const delta = o.drivingMinutes - (recommended?.drivingMinutes || 0);
                const worst = o.hubWeather.reduce((m, h) => Math.max(m, getHubWeatherRisk(h.reading)), 0);
                const t = tone(worst);
                return (
                  <button key={o.id} type="button" className="nw-option" aria-pressed={o.id === selected.id} onClick={() => chooseOption(o.id)}>
                    <span className="nw-badge">{o.id === recommended.id ? 'Recommended' : `Alternative ${i}`}</span>
                    <span className="nw-path">{o.hubNames.join(' → ')}</span>
                    <span className="nw-big">{duration(o.drivingMinutes)}</span>
                    <span className="nw-delta">{o.id === recommended.id ? 'Best overall score' : `${delta === 0 ? 'Same drive time' : `${signed(delta)} min drive`} · score ${signed(o.score - recommended.score)}`}</span>
                    <dl>
                      <div><dt>Distance</dt><dd>{fmt(o.distanceKm)} km</dd></div>
                      <div><dt>Traffic</dt><dd>{o.trafficCoveragePct === 100 ? 'Live' : o.trafficCoveragePct > 0 ? `${o.trafficCoveragePct}% live` : 'Not live'}{o.trafficDelayMinutes != null ? ` · ${o.trafficDelayMinutes} min delay` : ''}</dd></div>
                      <div><dt>Weather</dt><dd><span className={`nw-tone ${t.key}`}>{t.label}</span></dd></div>
                      <div><dt>Capacity</dt><dd>{o.capacityPressureCount ? `${o.capacityPressureCount} pressured leg${o.capacityPressureCount > 1 ? 's' : ''}` : 'No pressure'}</dd></div>
                      <div><dt>Transport cost / parcel</dt><dd>{o.costDataAvailable ? `₹${o.syntheticCostPerParcel.toFixed(2)}` : 'Not in Supabase'}</dd></div>
                      <div><dt>Cost for {fmt(plannedParcels)} manually specified parcels</dt><dd>{o.costDataAvailable ? `₹${fmt(o.syntheticCostPerParcel * plannedParcels)}` : 'Unavailable'}</dd></div>
                      <div><dt>Traffic colour data</dt><dd>{o.trafficIncidentCount ? `${o.trafficIncidentCount} reported section(s)` : o.trafficCoveragePct ? 'Provider time estimate' : 'No live data'}</dd></div>
                    </dl>
                  </button>
                );
              })}
            </div>
            <p className="note">{current.rankingMethod}.</p>
          </section>

          {/* 3 — operational recovery actions: powered only by imported Supabase records */}
          <section className="card nw-step">
            <div className="nw-stephead">
              <span className="nw-num">3</span>
              <div>
                <div className="eyebrow">OPTIMISE THE RECOVERY PLAN</div>
                <h2>Which combination of actions gives the best outcome?</h2>
                <p className="sub">
                  This restores the original Network Watch decision workflow: divert parcels, add temporary capacity,
                  prioritise SLA-critical orders and adjust promises only where the supplied data supports it.
                  Delivery outcomes and costs below come from Supabase operational tables, not fabricated order counts.
                </p>
              </div>
            </div>

            {recoveryLoading && <p className="verdict">Loading real delivery orders, lane loads, hub capacity and intervention costs from Supabase…</p>}
            {recoveryError && <p className="verdict">Recovery planning could not load: {recoveryError}</p>}

            {!recoveryLoading && recoveryAnalysis && !recoveryAnalysis.ready && (
              <div className="answer">
                <b>Operational data is not ready yet — no order or cost results have been invented.</b>
                <p>{recoveryAnalysis.message || 'Import the actual operational data required to evaluate interventions.'}</p>
                {recoveryAnalysis.counts && (
                  <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
                    <div><small>Active orders for journey</small><strong>{fmt(recoveryAnalysis.counts.activeOrders)}</strong></div>
                    <div><small>Lane metric rows</small><strong>{fmt(recoveryAnalysis.counts.laneMetricRows)}</strong></div>
                    <div><small>Hub metric rows</small><strong>{fmt(recoveryAnalysis.counts.hubMetricRows)}</strong></div>
                    <div><small>Intervention policy rows</small><strong>{fmt(recoveryAnalysis.counts.interventionCostRows)}</strong></div>
                  </div>
                )}
                {recoveryAnalysis.missingRequirements?.length > 0 && (
                  <>
                    <h3 className="nw-h3">What needs to be loaded</h3>
                    <ul className="nw-list">
                      {recoveryAnalysis.missingRequirements.map(requirement => <li key={requirement}>{requirement}</li>)}
                    </ul>
                  </>
                )}
                <p className="note">
                  Run <code>supabase-operational-schema.sql</code> in Supabase SQL Editor, then import authorised rows into
                  <code> delivery_orders</code>, <code> lane_operating_metrics</code>, <code> hub_operating_metrics</code> and
                  <code> intervention_costs</code>. CSV templates are included with this patch. Do not load customer names,
                  phone numbers or addresses; pseudonymous order IDs are enough.
                </p>
              </div>
            )}

            {!recoveryLoading && recoveryAnalysis?.ready && (
              <>
                <div className="nw-recommendation">
                  <div className="nw-recommendation-copy">
                    <div className="eyebrow">BEST FEASIBLE INTERVENTION COMBINATION</div>
                    <h3>
                      {(recommendedRecoveryPlan?.actions || []).length
                        ? recoveryAnalysis.actions.filter(action => recommendedRecoveryPlan.actions.includes(action.key)).map(action => action.title).join(' + ')
                        : 'No intervention required under loaded lane metrics'}
                    </h3>
                    <p>
                      The engine compares available combinations and ranks them by projected late parcel units (or remaining capacity gap
                      if SLA forecasting data is incomplete), then promise changes, then the configured incremental cost. This is a
                      greedy, capacity-feasible heuristic—not a globally optimal multi-commodity flow solver.
                    </p>
                  </div>
                  <div className="nw-recommendation-metrics">
                    <div><small>Over capacity / day</small><strong>{fmt(recommendedRecoveryPlan?.overCapacityParcelsPerDay)}</strong></div>
                    <div><small>Diverted / day</small><strong>{fmt(recommendedRecoveryPlan?.divertedParcelsPerDay)}</strong></div>
                    <div><small>Temporary capacity added / day</small><strong>{fmt(recommendedRecoveryPlan?.temporaryCapacityUsedParcelsPerDay)}</strong></div>
                    <div><small>Promises adjusted +1 day</small><strong>{recommendedRecoveryPlan?.promisesAdjustedParcels == null ? 'Unavailable' : fmt(recommendedRecoveryPlan.promisesAdjustedParcels)}</strong></div>
                    <div><small>Affected cohort projected on-time</small><strong>{recommendedRecoveryPlan?.projectedOnTimeParcels == null ? 'Needs SLA + delay data' : fmt(recommendedRecoveryPlan.projectedOnTimeParcels)}</strong></div>
                    <div><small>Affected cohort still late</small><strong>{recommendedRecoveryPlan?.projectedLateParcels == null ? 'Needs SLA + delay data' : fmt(recommendedRecoveryPlan.projectedLateParcels)}</strong></div>
                    <div><small>Incremental plan cost</small><strong>{recommendedRecoveryPlan?.operationalCostINR == null ? 'Unavailable' : `₹${fmt(recommendedRecoveryPlan.operationalCostINR)}`}</strong></div>
                    <div><small>Orders on affected lanes</small><strong>{fmt(recommendedRecoveryPlan?.ordersInAffectedLanes)}</strong></div>
                  </div>
                  <div className="nw-recommendation-footer">
                    <span>
                      Source: Supabase operational tables. {recommendedRecoveryPlan?.slaMetricsAvailable
                        ? 'SLA estimates use stored promised and current ETA fields plus the configured lane delay model.'
                        : 'Order-level on-time/late estimates are withheld until promised ETAs and delay-model inputs are present.'}
                    </span>
                    <button type="button" className="primary" onClick={useRecommendedRecoveryPlan} disabled={selectedRecoveryPlan?.id === recommendedRecoveryPlan?.id}>
                      {selectedRecoveryPlan?.id === recommendedRecoveryPlan?.id ? 'Recommended combination selected' : 'Apply recommended combination'}
                    </button>
                  </div>
                </div>

                <h3 className="nw-h3">Try a different combination</h3>
                <p className="note">Toggle actions to compare the returned plan combinations. Unavailable interventions stay disabled until the required real capacity or cost inputs exist.</p>
                <div className="nw-action-grid">
                  {recoveryAnalysis.actions.map(action => {
                    const checked = (selectedRecoveryPlan?.actions || []).includes(action.key);
                    return (
                      <label key={action.key} className={`nw-action-card ${checked ? 'selected' : ''} ${!action.available ? 'disabled' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!action.available}
                          onChange={event => toggleRecoveryAction(action.key, event.target.checked)}
                        />
                        <span><b>{action.title}</b><small>{action.description}</small>{!action.available && <small className="nw-cell-sub">Needs additional Supabase inputs</small>}</span>
                      </label>
                    );
                  })}
                </div>

                {selectedRecoveryPlan && (
                  <>
                    <h3 className="nw-h3">Selected combination — outcomes</h3>
                    <div className="route-result nw-metrics">
                      <div><small>Capacity gap remaining / day</small><strong>{fmt(selectedRecoveryPlan.remainingOverflowParcelsPerDay)}</strong></div>
                      <div><small>Diverted volume / day</small><strong>{fmt(selectedRecoveryPlan.divertedParcelsPerDay)}</strong></div>
                      <div><small>Temporary capacity used / day</small><strong>{fmt(selectedRecoveryPlan.temporaryCapacityUsedParcelsPerDay)}</strong></div>
                      <div><small>Adjusted promises</small><strong>{selectedRecoveryPlan.promisesAdjustedParcels == null ? 'Unavailable' : fmt(selectedRecoveryPlan.promisesAdjustedParcels)}</strong></div>
                      <div><small>Affected cohort on-time</small><strong>{selectedRecoveryPlan.projectedOnTimeParcels == null ? 'Unavailable' : fmt(selectedRecoveryPlan.projectedOnTimeParcels)}</strong></div>
                      <div><small>Affected cohort still late</small><strong>{selectedRecoveryPlan.projectedLateParcels == null ? 'Unavailable' : fmt(selectedRecoveryPlan.projectedLateParcels)}</strong></div>
                      <div><small>Incremental transport cost</small><strong>₹{fmt(selectedRecoveryPlan.diversionIncrementalCostINR)}</strong></div>
                      <div><small>Temporary capacity cost</small><strong>₹{fmt(selectedRecoveryPlan.temporaryCapacityCostINR)}</strong></div>
                      <div><small>Promise adjustment cost</small><strong>{selectedRecoveryPlan.promiseAdjustmentCostINR == null ? 'Unavailable' : `₹${fmt(selectedRecoveryPlan.promiseAdjustmentCostINR)}`}</strong></div>
                      <div><small>Total operational cost</small><strong>₹{fmt(selectedRecoveryPlan.operationalCostINR)}</strong></div>
                      <div><small>SLA-critical parcels protected</small><strong>{selectedRecoveryPlan.slaCriticalProtectedParcels == null ? 'Not selected' : fmt(selectedRecoveryPlan.slaCriticalProtectedParcels)}</strong></div>
                    </div>

                    {selectedRecoveryPlan.diversions?.length > 0 ? (
                      <div className="tablewrap" style={{ marginTop: 12 }}>
                        <table>
                          <thead><tr><th>Disrupted lane</th><th>Alternative path</th><th>Parcels diverted / day</th><th>Extra cost per parcel</th><th>Extra transit</th></tr></thead>
                          <tbody>
                            {selectedRecoveryPlan.diversions.map((route, index) => (
                              <tr key={`${route.disruptedLaneKey}-${index}`}>
                                <td>{HUBS[route.from]?.name || route.from} → {HUBS[route.to]?.name || route.to}</td>
                                <td>{(route.path || []).map(id => HUBS[id]?.name || id).join(' → ')}</td>
                                <td>{fmt(route.divertedParcelsPerDay)}</td>
                                <td>{route.incrementalCostPerParcelINR == null ? 'Unavailable' : `₹${fmt1(route.incrementalCostPerParcelINR)}`}</td>
                                <td>{route.additionalMinutes == null ? 'Unavailable' : `+${route.additionalMinutes} min`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="note">No divertible excess was assigned through alternate lanes under this combination.</p>}

                    {selectedRecoveryPlan.notes?.map(note => <p className="note" key={note}>{note}</p>)}
                  </>
                )}
              </>
            )}
          </section>

          {/* 4 — actual road map with traffic-colored selected route */}
          <section className="card nw-step">
            <div className="nw-stephead">
              <span className="nw-num">4</span>
              <div>
                <div className="eyebrow">LIVE ROAD CONDITIONS</div>
                <h2>Traffic on {selected.hubNames.join(' → ')}</h2>
                <p className="sub">
                  The map overlays TomTom live traffic-flow tiles on real OpenStreetMap roads. The selected route is drawn on top, with reported slowdowns/incidents highlighted when TomTom returns them. Green means no slowdown was reported by the route signal—not a guarantee that a road is clear.
                </p>
              </div>
            </div>

            <RouteMap options={options} selected={selected} readings={readings} onSelect={chooseOption} />
            <div className="legend">
              <span><i className="key" style={{ background: '#16806a' }} /> Route signal: no reported slowdown</span>
              <span><i className="key" style={{ background: '#dfb323' }} /> Slow / minor delay</span>
              <span><i className="key" style={{ background: '#ed7d21' }} /> Moderate congestion</span>
              <span><i className="key" style={{ background: '#d7353e' }} /> Heavy traffic</span>
              <span><i className="key" style={{ background: '#a91f2c' }} /> Reported road closure</span>
              <span><i className="key" style={{ background: '#84939b' }} /> No live route signal</span>
              <span><i className="key" style={{ background: '#647681' }} /> Other candidate route (click to select)</span>
            </div>

            <div className="route-result nw-metrics">
              <div><small>Journey traffic coverage</small><strong>{selected.trafficCoveragePct}% of legs</strong></div>
              <div><small>Reported traffic delay</small><strong>{selected.trafficDelayMinutes == null ? 'Unavailable' : `${selected.trafficDelayMinutes} min`}</strong></div>
              <div><small>Road length affected by traffic events</small><strong>{selected.trafficLengthKm ? `${fmt1(selected.trafficLengthKm)} km` : selected.trafficIncidentCount ? 'Reported; distance unavailable' : 'No section returned'}</strong></div>
              <div><small>Traffic sections returned</small><strong>{selected.trafficIncidentCount || 0}</strong></div>
            </div>

            <div className="nw-traffic-intelligence">
              <div className="nw-traffic-intelligence-head">
                <div>
                  <h3 className="nw-h3">What traffic data says by leg</h3>
                  <p className="note">This table explains the route colours: live provider time, reported delay and incident sections where available. A traffic-aware time estimate does not always include a mappable incident section.</p>
                </div>
                <span className={`nw-traffic-pill ${selected.trafficCoveragePct === 100 ? (selected.trafficSeverity || 'freeflow') : 'unknown'}`}>
                  {selected.trafficCoveragePct === 100 ? 'Traffic returned for all legs' : selected.trafficCoveragePct > 0 ? `Traffic for ${selected.trafficCoveragePct}% of legs` : 'No live traffic on route'}
                </span>
              </div>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Road leg</th><th>Condition</th><th>Current estimate</th><th>Free-flow estimate</th><th>Reported delay</th><th>Traffic details</th></tr></thead>
                  <tbody>
                    {selected.segments.map(segment => {
                      const severity = segment.trafficSeverity || 'unknown';
                      const details = (segment.trafficSections || []).map(section => {
                        const pieces = [section.category?.replaceAll('_', ' ') || 'Traffic event'];
                        if (section.delayMinutes != null) pieces.push(`${section.delayMinutes} min delay`);
                        if (section.effectiveSpeedKmh != null) pieces.push(`${section.effectiveSpeedKmh} km/h`);
                        return pieces.join(' · ');
                      });
                      return (
                        <tr key={`traffic-${segment.laneKey}`}>
                          <td><b>{segment.fromName} → {segment.toName}</b></td>
                          <td>
                            <span className={`nw-traffic-pill ${segment.trafficAvailable ? severity : 'unknown'}`}>
                              {segment.trafficAvailable ? severity === 'unknown' ? 'Live estimate' : severity : 'Baseline only'}
                            </span>
                          </td>
                          <td>{segment.durationMinutes == null ? '—' : duration(segment.durationMinutes)}</td>
                          <td>{segment.noTrafficDurationMinutes == null ? 'Unavailable' : duration(segment.noTrafficDurationMinutes)}</td>
                          <td>{segment.trafficDelayMinutes == null ? 'Unavailable' : `${segment.trafficDelayMinutes} min`}</td>
                          <td>
                            {details.length ? details.join(' · ') : segment.trafficAvailable ? 'No incident-level section returned' : 'No live traffic feed for this leg'}
                            {segment.trafficIncidentCount > 0 ? <small className="nw-cell-sub">{segment.trafficIncidentCount} reported section(s){segment.trafficLengthKm ? ` · ${fmt1(segment.trafficLengthKm)} km affected` : ''}</small> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="note">
              Source: {selected.source}. {selected.trafficCoveragePct < 100
                ? 'Some or all legs use baseline road-time estimates because live traffic was not returned for those legs. Configure TOMTOM_API_KEY in Vercel for traffic-aware estimates.'
                : selected.trafficIncidentCount
                  ? 'Colored incident segments represent traffic sections returned by TomTom. This is a route estimate, not a guarantee of truck-specific speed or access.'
                  : 'TomTom returned traffic-aware journey estimates but no separately mapped traffic incident sections for this path. The table shows available journey-time signals; absence of an incident section does not guarantee every road is clear.'}
              {' '}Map tiles © OpenStreetMap contributors.
            </p>
          </section>

          {/* 4 — why */}
          <section className="card nw-step">
            <div className="nw-stephead"><span className="nw-num">5</span><div><div className="eyebrow">WHY THIS ROUTE</div><h2>{selected.id === recommended.id ? 'Why it is recommended' : 'How this alternative compares'}</h2></div></div>

            <div className="route-result nw-metrics">
              <div><small>Journey time</small><strong>{duration(selected.drivingMinutes)}</strong></div>
              <div><small>Road distance</small><strong>{fmt(selected.distanceKm)} km</strong></div>
              <div><small>Traffic coverage</small><strong>{selected.trafficCoveragePct}%{selected.trafficDelayMinutes != null ? ` · ${selected.trafficDelayMinutes} min delay` : ''}</strong></div>
              <div><small>Weather slowdown (modelled)</small><strong>{selected.weatherPenaltyMinutes} min</strong></div>
              <div><small>Capacity pressure</small><strong>{selected.capacityPressureCount ? `${selected.capacityPressureCount} leg(s) · ${fmt(selected.estimatedOverflowParcelsPerDay)} parcels/day over` : 'None modelled'}</strong></div>
            </div>

            {selected.id === recommended.id
              ? <ul className="nw-list">{reasons.map(r => <li key={r}>{r}</li>)}</ul>
              : <p className="verdict">Recommended instead: <b>{recommended.hubNames.join(' → ')}</b> ({duration(recommended.drivingMinutes)}, score {recommended.score} vs {selected.score}). <button type="button" className="chip" onClick={() => chooseOption(recommended.id)}>Switch to recommended</button></p>}

            <h3 className="nw-h3">Score breakdown <small>(minutes-equivalent, lower is better)</small></h3>
            <div className="nw-bars">
              {options.map(o => (
                <div key={o.id} className="nw-bar">
                  <span className="nw-barlabel">{o.hubNames.join(' → ')}{o.id === recommended.id ? ' ★' : ''}</span>
                  <div className="nw-bartrack" style={{ width: `${(o.score / maxScore) * 100}%` }}>
                    {[['drivingMinutes', '#123d4a', 'Driving'], ['weatherPenaltyMinutes', '#d98b16', 'Weather'], ['capacityPenaltyMinutes', '#c33c3c', 'Capacity'], ['syntheticCostPenaltyMinutes', '#9aa9b1', 'Cost']].map(([k, c, label]) => (
                      <i key={k} title={`${label}: ${o.scoreParts[k]} min`} style={{ background: c, flexGrow: Math.max(o.scoreParts[k], 0) }} />
                    ))}
                  </div>
                  <b>{o.score}</b>
                </div>
              ))}
              <div className="legend"><span><i className="key" style={{ background: '#123d4a' }} /> Driving</span><span><i className="key" style={{ background: '#d98b16' }} /> Weather slowdown</span><span><i className="key" style={{ background: '#c33c3c' }} /> Capacity pressure</span><span><i className="key" style={{ background: '#9aa9b1' }} /> {recommended?.costDataAvailable ? 'Supabase lane cost' : 'Cost unavailable (not scored'}{recommended?.costDataAvailable ? '' : ')'}</span></div>
            </div>

            <h3 className="nw-h3">How the network diverts the load</h3>
            <p className="sub">
              This is the logistics-lane graph, separate from the physical road map above. Red dashed links are fully unavailable in the selected what-if; green arrows trace the chosen hub sequence; amber links have reduced modelled capacity.
            </p>
            <NetworkDiversionMap laneState={networkLaneState} selected={selected} readings={readings} />

            <h3 className="nw-h3">Leg by leg</h3>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Leg</th><th>Distance</th><th>Drive time</th><th>Live traffic</th><th>Weather effect</th><th>Capacity</th></tr></thead>
                <tbody>
                  {selected.segments.map(s => (
                    <tr key={s.laneKey}>
                      <td>{s.fromName} → {s.toName}</td>
                      <td>{s.distanceKm == null ? '—' : `${fmt(s.distanceKm)} km`}</td>
                      <td>{s.durationMinutes == null ? `~${duration(s.modeledMinutes)} (modelled)` : duration(s.durationMinutes)}</td>
                      <td>
                        <span className={`nw-traffic-pill ${s.trafficSeverity || 'unknown'}`}>
                          {s.trafficAvailable ? (s.trafficSeverity || 'live estimate') : 'baseline only'}
                        </span>
                        <small className="nw-cell-sub">
                          {s.trafficDelayMinutes == null ? 'Delay unavailable' : `${s.trafficDelayMinutes} min reported delay`}
                          {s.trafficIncidentCount ? ` · ${s.trafficIncidentCount} section(s)` : ''}
                        </small>
                      </td>
                      <td>{s.weatherCut > 0 ? `−${Math.round(s.weatherCut * 100)}% capacity, +${s.weatherPenaltyMinutes} min` : 'None modelled'}</td>
                      <td>{s.estimatedOverflow > 0 ? `${fmt(s.estimatedOverflow)} parcels/day over` : 'OK'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">Source: {selected.source}. {selected.trafficCoveragePct < 100 ? 'Some legs use baseline OpenStreetMap/OSRM estimates because live traffic was unavailable.' : 'Traffic-aware estimates are not a commercial-vehicle guarantee.'}</p>

            <details className="nw-details">
              <summary>Weather readings used for this decision ({selected.hubWeather.length} route hubs)</summary>
              <p className="note">Only hubs on the selected path appear here. These are point readings used as corridor proxies; they are not weather observations at every road segment and do not prove a road is closed.</p>
              <div className="nw-weathergrid">
                {selected.hubWeather.map(h => {
                  const t = hubTone(h.reading);
                  return (
                    <article key={h.id} className="nw-wxcard">
                      <div className="nw-wxtop">
                        <div><b>{h.name}</b><small>{h.role === 'origin' ? 'Origin hub' : h.role === 'destination' ? 'Destination hub' : 'Via hub'}</small></div>
                        <span className={`nw-tone ${t.key}`}>{t.label}</span>
                      </div>
                      {h.reading ? (
                        <div className="nw-wxgrid">
                          <div><small>Temperature</small><b>{fmt1(h.reading.temperature)}°C</b></div>
                          <div><small>Precipitation</small><b>{fmt1(h.reading.precipitation)} mm</b></div>
                          <div><small>Wind gusts</small><b>{fmt1(h.reading.windGusts)} km/h</b></div>
                        </div>
                      ) : <p className="note">No current reading available.</p>}
                    </article>
                  );
                })}
              </div>
              <p className="note">Weather source: {routeWeather?.source || 'unavailable'}{weatherUpdated ? ` · Last update ${weatherUpdated}` : ''}. Risk thresholds are prototype heuristics, not official warnings.</p>
            </details>

            <h3 className="nw-h3">Check before dispatch</h3>
            <ul className="nw-list">{checks.map(c => <li key={c}>{c}</li>)}</ul>
          </section>

          {/* 5 — copilot */}
          <section className="card nw-step">
            <div className="nw-stephead"><span className="nw-num">6</span><div><div className="eyebrow">AI OPERATIONS COPILOT</div><h2>Ask about this journey</h2></div></div>
            <p className="sub">The copilot sees the selected path, the competing options, weather for these {selected.nodes.length} hubs, traffic coverage and capacity pressure. It changes when you switch routes.</p>
            <div className="prompts">{prompts.map(p => <button key={p} type="button" className="chip" onClick={() => askCopilot(p)} disabled={chatLoading}>{p}</button>)}</div>
            {messages.length > 0 && (
              <div className="nw-chat">
                {messages.map((m, i) => <div key={i} className={`nw-msg ${m.role}`}>{m.text}</div>)}
                {chatLoading && <div className="nw-msg assistant">Thinking…</div>}
              </div>
            )}
            <div className="askrow">
              <input value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') askCopilot(); }} placeholder="e.g. Is it worth taking the longer route if rain eases by evening?" />
              <button className="primary" type="button" onClick={() => askCopilot()} disabled={chatLoading}>Ask copilot</button>
            </div>
            {aiSource && <p className="note">Answered by: {aiSource}</p>}
          </section>

          {/* 6 — record */}
          <section className="card nw-step">
            <div className="nw-stephead"><span className="nw-num">7</span><div><div className="eyebrow">RECORD THE DECISION</div><h2>Save this journey</h2></div></div>
            <p className="sub">Stores the selected path, alternatives, route-hub weather, traffic coverage and capacity context through your Supabase integration.</p>
            <button className="primary" type="button" onClick={saveJourney} disabled={saving} style={{ marginTop: 12 }}>{saving ? 'Saving…' : `Save ${selected.hubNames.join(' → ')}`}</button>
            {saveMsg && <p className="note">{saveMsg}</p>}
          </section>
        </>
      )}

      <section className="card">
        <div className="sectionhead"><div><div className="eyebrow">HISTORY</div><h2>Saved journeys</h2></div><span className="pill">Supabase-ready</span></div>
        {history.length ? (
          <div className="history">
            {history.map((item, i) => (
              <div key={item.id || i}>
                <b>{item.scenario_name || item.scenarioName || 'Journey'}</b>
                <span>{item.created_at ? new Date(item.created_at).toLocaleString() : 'Saved in current session'}</span>
                <small>{item.summary || ''}</small>
              </div>
            ))}
          </div>
        ) : <p className="note">No saved journeys yet.</p>}
      </section>

      <footer className="note">
        Portfolio prototype • Operational orders, lane capacity and costs are shown only when loaded from Supabase; absent data is not fabricated • Weather at hub coordinates is corridor context, not a confirmed road closure • Not affiliated with or using proprietary Delhivery data.
      </footer>
    </main>
  );
}
