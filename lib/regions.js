// Network Watch region data.
// ALL HUBS, LANES, CAPACITIES, VOLUMES AND COSTS ARE SYNTHETIC SAMPLE DATA (invented for this demo).
// Weather is stored as: gust = mph, rain = mm/hour, snow = cm/hour, vis = metres (fog).
// Saved scenarios are illustrative approximations, not official records.

const kmh = x => Math.round(x / 1.609); // India scenarios are written in km/h and stored in mph

// ---------- North India (default region) ----------
// Hub coordinates are real city locations; everything else about the network is sample data.
const IN_C = {
  ATQ: [31.63, 74.87], LDH: [30.90, 75.85], CHD: [30.73, 76.78], DED: [30.32, 78.03],
  DEL: [28.61, 77.21], MRT: [28.98, 77.71], BLY: [28.37, 79.43], ALW: [27.55, 76.60],
  JAI: [26.91, 75.79], AJM: [26.45, 74.64], ALG: [27.88, 78.08], AGR: [27.18, 78.01],
  GWL: [26.22, 78.18], KNP: [26.45, 80.33], LKO: [26.85, 80.95], PRG: [25.44, 81.85],
  VNS: [25.32, 82.97]
};
const IN_NM = {
  ATQ: 'Amritsar', LDH: 'Ludhiana', CHD: 'Chandigarh', DED: 'Dehradun', DEL: 'Delhi NCR',
  MRT: 'Meerut', BLY: 'Bareilly', ALW: 'Alwar', JAI: 'Jaipur', AJM: 'Ajmer', ALG: 'Aligarh',
  AGR: 'Agra', GWL: 'Gwalior', KNP: 'Kanpur', LKO: 'Lucknow', PRG: 'Prayagraj', VNS: 'Varanasi'
};
// Map projection for the SVG (equirectangular, scaled for ~28.5°N) so real road geometry lines up with hubs.
export const IN_PROJ = { lon0: 73.6, lat0: 32.2, kx: 70 * Math.cos(28.5 * Math.PI / 180), ky: 70, ox: 40, oy: 30 };
export const projectIN = (lat, lon) => [
  Math.round((IN_PROJ.ox + (lon - IN_PROJ.lon0) * IN_PROJ.kx) * 10) / 10,
  Math.round((IN_PROJ.oy + (IN_PROJ.lat0 - lat) * IN_PROJ.ky) * 10) / 10
];
const IN_P = Object.fromEntries(Object.entries(IN_C).map(([id, [la, lo]]) => [id, projectIN(la, lo)]));
// [from, to, lane capacity parcels/day, normal volume parcels/day, road km, optional truck speed km/h (expressways)]
// Speeds are only used when live TomTom traffic is unavailable; the default is 45 km/h.
const IN_L = [
  ['DEL', 'CHD', 7000, 5000, 245, 55], ['CHD', 'LDH', 5000, 3400, 100], ['LDH', 'ATQ', 4000, 2800, 140],
  ['DEL', 'LDH', 4500, 3100, 310], ['CHD', 'DED', 3000, 1900, 170], ['DEL', 'DED', 4000, 2700, 250],
  ['DEL', 'MRT', 6000, 4300, 75, 55], ['MRT', 'DED', 3000, 2000, 170], ['MRT', 'BLY', 3500, 2300, 210],
  ['DEL', 'BLY', 4000, 2900, 250], ['BLY', 'LKO', 4500, 3100, 250], ['DEL', 'JAI', 8000, 5900, 280, 50],
  ['DEL', 'ALW', 3500, 2100, 160], ['ALW', 'JAI', 3500, 2000, 150], ['JAI', 'AJM', 4000, 2700, 135],
  ['JAI', 'AGR', 4000, 2600, 240], ['DEL', 'AGR', 8000, 6100, 230, 65], ['DEL', 'ALG', 4500, 3000, 140],
  ['ALG', 'AGR', 4000, 2600, 85], ['ALG', 'BLY', 2500, 1500, 180], ['AGR', 'GWL', 4000, 2700, 120],
  ['AGR', 'LKO', 7000, 5000, 335, 65], ['AGR', 'KNP', 4000, 2600, 280], ['GWL', 'KNP', 2500, 1500, 260],
  ['KNP', 'LKO', 6000, 4300, 90, 55], ['LKO', 'VNS', 4500, 3100, 300], ['KNP', 'PRG', 4500, 3000, 200],
  ['PRG', 'VNS', 4000, 2600, 125], ['LKO', 'PRG', 3000, 1900, 200]
];
// Hub sort capacity = normal daily throughput x headroom. Delhi and Lucknow are deliberately tight.
const IN_HEADROOM = { DEL: 1.12, LKO: 1.08, AGR: 1.15, KNP: 1.18 };
const IN_H = Object.fromEntries(Object.keys(IN_C).map(id => {
  const thr = IN_L.filter(l => l[0] === id || l[1] === id).reduce((s, l) => s + l[3], 0);
  return [id, { cap: Math.round(thr * (IN_HEADROOM[id] || 1.25) / 100) * 100 }];
}));

const IN_SC = {
  agra: {
    name: 'Agra corridor disruption',
    note: 'Illustrative: winter fog around Agra and Aligarh plus a simulated closure of the Delhi–Agra expressway after an accident.',
    wx: { AGR: { gust: kmh(10), rain: 0, vis: 550 }, ALG: { gust: kmh(8), rain: 0, vis: 800 }, GWL: { gust: kmh(8), rain: 0, vis: 1200 }, DEL: { gust: kmh(10), rain: 0, vis: 1100 }, JAI: { gust: kmh(12), rain: 0, vis: 2000 } },
    closed: ['DEL-AGR']
  },
  monsoon: {
    name: 'Monsoon heavy rain (Lucknow–Varanasi)',
    note: 'Illustrative: very heavy monsoon rain across central and eastern Uttar Pradesh with waterlogging at hubs.',
    wx: { LKO: { gust: kmh(45), rain: 22 }, KNP: { gust: kmh(40), rain: 18 }, PRG: { gust: kmh(45), rain: 24 }, VNS: { gust: kmh(50), rain: 26 }, BLY: { gust: kmh(30), rain: 9 }, AGR: { gust: kmh(25), rain: 5 } }
  },
  dust: {
    name: 'Dust storm (Rajasthan–Delhi)',
    note: 'Illustrative: a pre-monsoon dust storm with strong gusts and poor visibility from Ajmer to Delhi.',
    wx: { AJM: { gust: kmh(110), rain: 1, vis: 400 }, JAI: { gust: kmh(105), rain: 2, vis: 500 }, ALW: { gust: kmh(95), rain: 1, vis: 700 }, DEL: { gust: kmh(80), rain: 3, vis: 900 }, AGR: { gust: kmh(65), rain: 1 } }
  },
  surge: {
    name: 'Lucknow sort-centre overload',
    note: 'Illustrative: festive-season volume 30% above normal into Lucknow while one sorter line is down. Roads and weather are normal.',
    wx: {}, surge: { LKO: 1.3 }, hubCut: { LKO: 0.15 }
  },
  delhiStaffShortfall: {
    name: 'Delhi NCR staffing shortfall (−25% sort capacity)',
    note: 'Illustrative staffing scenario: Delhi hub sort capacity is reduced by 25% to represent fewer available sorters. This is a saved stress test, not live staffing data.',
    wx: {}, hubCut: { DEL: 0.25 }
  },
  calm: {
    name: 'No disruption (normal day)',
    note: 'Normal weather, open roads, normal volumes. Useful as a baseline.',
    wx: {}
  }
};

// ---------- United States (original) ----------
const US = {
  name: 'United States', vb: '0 0 900 600',
  hint: 'Start with Hurricane Ian to see the full effect. "Live now" shows today\'s real weather at every hub, which is often calm.',
  P: { SEA: [90, 70], SFO: [60, 250], LAX: [120, 390], PHX: [250, 440], DEN: [330, 260], DAL: [440, 440], HOU: [470, 520], MSP: [470, 110], KC: [480, 280], CHI: [600, 180], NYC: [780, 190], BOS: [830, 100], CLT: [760, 326], BNA: [574, 313], BHM: [543, 394], ATL: [648, 394], SAV: [766, 416], JAX: [772, 475], MCO: [748, 530], TPA: [673, 543], RSW: [698, 586], MIA: [816, 580] },
  NM: { SEA: 'Seattle', SFO: 'San Francisco', LAX: 'Los Angeles', PHX: 'Phoenix', DEN: 'Denver', DAL: 'Dallas', HOU: 'Houston', MSP: 'Minneapolis', KC: 'Kansas City', CHI: 'Chicago', NYC: 'New York', BOS: 'Boston', CLT: 'Charlotte', BNA: 'Nashville', BHM: 'Birmingham', ATL: 'Atlanta', SAV: 'Savannah', JAX: 'Jacksonville', MCO: 'Orlando', TPA: 'Tampa', RSW: 'Fort Myers', MIA: 'Miami' },
  C: { SEA: [47.61, -122.33], SFO: [37.77, -122.42], LAX: [34.05, -118.24], PHX: [33.45, -112.07], DEN: [39.74, -104.99], DAL: [32.78, -96.8], HOU: [29.76, -95.37], MSP: [44.98, -93.27], KC: [39.1, -94.58], CHI: [41.88, -87.63], NYC: [40.71, -74.01], BOS: [42.36, -71.06], CLT: [35.22, -80.84], BNA: [36.16, -86.78], BHM: [33.52, -86.8], ATL: [33.75, -84.39], SAV: [32.08, -81.09], JAX: [30.33, -81.66], MCO: [28.54, -81.38], TPA: [27.95, -82.46], RSW: [26.64, -81.87], MIA: [25.76, -80.19] },
  L: [['BNA', 'ATL', 6000, 4300], ['BNA', 'BHM', 3000, 1900], ['BHM', 'ATL', 5000, 3600], ['CLT', 'ATL', 7000, 5200], ['CLT', 'SAV', 3500, 2300], ['ATL', 'SAV', 5500, 3900], ['ATL', 'JAX', 9000, 6400], ['SAV', 'JAX', 5000, 3300], ['JAX', 'MCO', 8000, 5900], ['JAX', 'TPA', 6000, 4100], ['ATL', 'TPA', 5000, 3200], ['ATL', 'MCO', 6500, 4200], ['MCO', 'TPA', 4500, 3000], ['MCO', 'RSW', 4000, 2800], ['TPA', 'RSW', 4000, 2900], ['MCO', 'MIA', 6000, 4300], ['RSW', 'MIA', 3500, 2100],
    ['SEA', 'SFO', 5000, 3500], ['SFO', 'LAX', 7000, 5000], ['LAX', 'PHX', 6000, 4200], ['SEA', 'DEN', 4500, 3100], ['SFO', 'DEN', 5000, 3500], ['PHX', 'DEN', 4500, 3000], ['PHX', 'DAL', 5500, 3900], ['DEN', 'KC', 6000, 4300], ['DEN', 'MSP', 4000, 2800], ['MSP', 'KC', 4000, 2800], ['MSP', 'CHI', 6000, 4300], ['KC', 'CHI', 6500, 4600], ['KC', 'DAL', 6000, 4200], ['DAL', 'HOU', 6500, 4600], ['DAL', 'ATL', 6500, 4600], ['HOU', 'BHM', 5500, 3800], ['KC', 'BNA', 5500, 3800], ['CHI', 'BNA', 6000, 4300], ['CHI', 'NYC', 7000, 5000], ['NYC', 'BOS', 6000, 4200], ['NYC', 'CLT', 6500, 4600], ['NYC', 'ATL', 5500, 3800]],
  SC: {
    ian: { name: 'Hurricane Ian replay', note: 'Approximate, illustrative conditions modeled on the 2022 Florida landfall. Not an official record.', wx: { RSW: { gust: 150, rain: 25 }, TPA: { gust: 90, rain: 15 }, MCO: { gust: 80, rain: 12 }, MIA: { gust: 35, rain: 6 }, JAX: { gust: 45, rain: 5 }, SAV: { gust: 25, rain: 1 }, ATL: { gust: 15, rain: 0 }, CLT: { gust: 10, rain: 0 }, BNA: { gust: 10, rain: 0 }, BHM: { gust: 10, rain: 0 } } },
    rain: { name: 'Heavy rain day', note: 'Illustrative: steady heavy rain across central and south Florida, little wind.', wx: { MCO: { gust: 25, rain: 14 }, TPA: { gust: 20, rain: 12 }, MIA: { gust: 22, rain: 16 }, RSW: { gust: 20, rain: 10 }, JAX: { gust: 15, rain: 8 }, ATL: { gust: 10, rain: 6 }, SAV: { gust: 12, rain: 6 }, CLT: { gust: 8, rain: 2 }, BNA: { gust: 8, rain: 1 }, BHM: { gust: 8, rain: 2 } } },
    wind: { name: 'Wind front (Southeast)', note: 'Illustrative: strong gusts from a cold front across Georgia, the Carolinas and Alabama.', wx: { ATL: { gust: 65, rain: 1 }, CLT: { gust: 70, rain: 1 }, BHM: { gust: 60, rain: 0 }, BNA: { gust: 55, rain: 0 }, SAV: { gust: 62, rain: 0 }, JAX: { gust: 58, rain: 0 }, MCO: { gust: 45, rain: 0 }, TPA: { gust: 40, rain: 0 }, RSW: { gust: 30, rain: 0 }, MIA: { gust: 25, rain: 0 } } },
    blizzard: { name: 'Midwest blizzard', note: 'Illustrative: heavy snow and strong wind across Minnesota, Chicago, Kansas City and the Rockies.', wx: { MSP: { gust: 55, rain: 1, snow: 5 }, CHI: { gust: 50, rain: 1, snow: 4.5 }, KC: { gust: 45, rain: 0, snow: 3 }, DEN: { gust: 40, rain: 0, snow: 2.5 }, NYC: { gust: 30, rain: 1, snow: 1 } } },
    west: { name: 'West Coast atmospheric river', note: 'Illustrative: heavy rain and wind along the Pacific coast.', wx: { SEA: { gust: 45, rain: 12 }, SFO: { gust: 50, rain: 18 }, LAX: { gust: 30, rain: 10 }, PHX: { gust: 15, rain: 2 } } },
    plains: { name: 'Southern Plains wind event', note: 'Illustrative: severe wind across Texas, Kansas and Colorado.', wx: { DAL: { gust: 65, rain: 3 }, KC: { gust: 70, rain: 2 }, DEN: { gust: 60, rain: 0 }, MSP: { gust: 55, rain: 0 }, HOU: { gust: 45, rain: 4 }, CHI: { gust: 50, rain: 1 } } }
  }
};

// Cost assumptions. All are the author's assumptions, not measured values.
// perKm/perHop/perHour price a diversion path per parcel. laneTemp = temporary transport capacity on damaged lanes,
// shift = extra sort shift at an overloaded hub. credit = goodwill credit per revised promise; trust = assumed
// customer-trust cost of a revised promise; lateStd/lateCrit = assumed cost of a parcel that misses its promise.
const USD_COSTS = {
  cur: '$', perKm: 0.5 / 400, perHop: 0.2, perHour: 0,
  laneTemp: { name: 'Add temporary capacity', share: 0.35, cost: 1.6, activationH: 0 },
  shift: null, credit: 0.3, trust: 2, lateStd: 6, lateCrit: 12, critShare: 0.35
};

export const REGIONS = {
  in: {
    id: 'in', name: 'North India', vb: '0 0 720 560', units: 'metric', projected: true,
    hint: 'Start with the Agra corridor disruption. Pick an origin and destination to see the hub sequence, live traffic and route weather.',
    P: IN_P, NM: IN_NM, C: IN_C, L: IN_L, H: IN_H, SC: IN_SC,
    costs: {
      cur: '₹', perKm: 0.035, perHop: 4, perHour: 2,
      laneTemp: { name: 'Hire market trucks on damaged lanes', share: 0.35, cost: 16, activationH: 5 },
      shift: { name: 'Extra sort shift at the overloaded hub', share: 0.3, cost: 9, activationH: 3 },
      credit: 10, trust: 45, lateStd: 120, lateCrit: 300, critShare: 0.3
    },
    defaults: { from: 'JAI', to: 'DEL', windowH: 12, slackH: 6 }
  },
  us: { id: 'us', ...US, units: 'imperial', costs: USD_COSTS, defaults: { windowH: 12, slackH: Infinity } },
  de: {
    id: 'de', name: 'Germany', vb: '0 0 700 560', units: 'imperial',
    hint: 'Start with the snowstorm. "Live now" shows today\'s real weather (Open-Meteo), which is often calm.',
    P: { HAM: [330, 60], BER: [570, 110], HAN: [330, 160], LEJ: [520, 240], CGN: [140, 260], FRA: [300, 340], NUE: [480, 410], STR: [300, 470], MUC: [470, 525] },
    NM: { HAM: 'Hamburg', BER: 'Berlin', HAN: 'Hannover', LEJ: 'Leipzig', CGN: 'Cologne', FRA: 'Frankfurt', NUE: 'Nuremberg', STR: 'Stuttgart', MUC: 'Munich' },
    C: { HAM: [53.55, 10.0], BER: [52.52, 13.4], HAN: [52.37, 9.73], LEJ: [51.34, 12.37], CGN: [50.94, 6.96], FRA: [50.11, 8.68], NUE: [49.45, 11.08], STR: [48.78, 9.18], MUC: [48.14, 11.58] },
    L: [['HAM', 'BER', 5000, 3600], ['HAM', 'HAN', 6000, 4300], ['HAN', 'BER', 6000, 4200], ['HAN', 'LEJ', 5500, 3800], ['BER', 'LEJ', 5000, 3500], ['HAN', 'CGN', 5500, 3900], ['HAN', 'FRA', 7000, 5100], ['LEJ', 'FRA', 5000, 3300], ['LEJ', 'NUE', 5000, 3400], ['CGN', 'FRA', 6000, 4400], ['FRA', 'NUE', 6500, 4600], ['FRA', 'STR', 6000, 4300], ['NUE', 'MUC', 6000, 4500], ['STR', 'MUC', 6000, 4200], ['NUE', 'STR', 3500, 2200]],
    SC: { snow: { name: 'Snowstorm in northern and central Germany', note: 'Illustrative: heavy snow and wind closing highways around Hannover, Berlin and Leipzig.', wx: { HAN: { gust: 50, rain: 2, snow: 4 }, BER: { gust: 40, rain: 1, snow: 3 }, HAM: { gust: 55, rain: 2, snow: 3 }, LEJ: { gust: 35, rain: 1, snow: 5 }, FRA: { gust: 30, rain: 0, snow: 2.5 }, CGN: { gust: 25, rain: 0, snow: 1 }, NUE: { gust: 35, rain: 1, snow: 3.5 }, STR: { gust: 20, rain: 0, snow: 1 }, MUC: { gust: 25, rain: 0, snow: 2 } } } },
    costs: USD_COSTS, defaults: { windowH: 12, slackH: Infinity }
  }
};

// US regional views (original feature).
export const US_REGION_LABELS = { all: 'All US', west: 'West & Mountain', midwest: 'Midwest', northeast: 'Northeast & Mid-Atlantic', southeast: 'Southeast', plains: 'Southern Plains' };
export const US_REGION_HUBS = {
  all: Object.keys(US.P),
  west: ['SEA', 'SFO', 'LAX', 'PHX', 'DEN'],
  midwest: ['DEN', 'MSP', 'KC', 'CHI', 'BNA'],
  northeast: ['CHI', 'NYC', 'BOS', 'CLT'],
  southeast: ['CLT', 'BNA', 'BHM', 'ATL', 'SAV', 'JAX', 'MCO', 'TPA', 'RSW', 'MIA'],
  plains: ['PHX', 'DEN', 'DAL', 'HOU', 'KC', 'BNA', 'BHM', 'ATL']
};
