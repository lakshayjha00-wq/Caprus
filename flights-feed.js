/**
 * Live flight data aggregator — civilian (OpenSky / FR24) + military (adsb.lol)
 */

const FEET_TO_M = 0.3048;
const KNOTS_TO_MS = 0.514444;

function parseAdsbAltMeters(ac) {
  if (ac.alt_baro === 'ground') {
    if (ac.alt_geom != null && typeof ac.alt_geom === 'number') return ac.alt_geom * FEET_TO_M;
    return 0;
  }
  const raw = ac.alt_baro ?? ac.alt_geom;
  if (raw == null || typeof raw !== 'number') return 0;
  return raw * FEET_TO_M;
}

function mapAdsbAircraft(ac) {
  if (ac.lat == null || ac.lon == null) return null;
  const gs = ac.gs || 0;
  if (ac.alt_baro === 'ground' && gs < 8) return null;

  const altM = parseAdsbAltMeters(ac);
  const track = ac.track ?? ac.true_heading ?? ac.mag_heading ?? 0;

  return {
    id: `mil-${ac.hex}`,
    callsign: (ac.flight || '').trim() || ac.r || ac.hex?.toUpperCase(),
    country: ac.dbFlags ? 'Military (adsb.lol)' : 'Unknown',
    lat: ac.lat,
    lon: ac.lon,
    track,
    alt: altM,
    velocity: gs * KNOTS_TO_MS,
    isMilitary: true,
    type: ac.t || ac.desc || 'Military',
    registration: ac.r || null,
    squawk: ac.squawk || null,
    source: 'adsb.lol',
    category: ac.category || null
  };
}

async function fetchAllAdsbData(fetchWithTimeout, log) {
  // Retrieve multiple categories from adsb.lol and merge them
  const endpoints = [
    'https://api.adsb.lol/v2/mil',
    'https://api.adsb.lol/v2/pia',
    'https://api.adsb.lol/v2/ladd'
  ];
  const allFlights = [];
  for (const url of endpoints) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Earth3DGlobe/1.0', Accept: 'application/json' }
      }, 25000);
      if (!response.ok) {
        log(`adsb.lol endpoint ${url} returned ${response.status}`, 'FLIGHTS');
        continue;
      }
      const data = await response.json();
      for (const ac of data.ac || []) {
        const flight = mapAdsbAircraft(ac);
        if (flight) allFlights.push(flight);
      }
    } catch (e) {
      log(`Error fetching ${url}: ${e.message}`, 'FLIGHTS');
    }
  }
  return allFlights;
}

  async function fetchAdsbMilitary(fetchWithTimeout, log) {
  log('Fetching military aircraft from adsb.lol...', 'FLIGHTS');
  const response = await fetchWithTimeout('https://api.adsb.lol/v2/mil', {
    headers: { 'User-Agent': 'Earth3DGlobe/1.0', Accept: 'application/json' }
  }, 25000);
  if (!response.ok) throw new Error(`adsb.lol returned ${response.status}`);
  const data = await response.json();
  const flights = [];
  for (const ac of data.ac || []) {
    const f = mapAdsbAircraft(ac);
    if (f) flights.push(f);
  }
  return flights;
}



async function fetchOpenSky(fetchWithTimeout, log) {
  log('Fetching civilian aircraft from OpenSky Network...', 'FLIGHTS');
  const response = await fetchWithTimeout('https://opensky-network.org/api/states/all', {
    headers: { 'User-Agent': 'Earth3DGlobe/1.0' }
  }, 15000);
  if (!response.ok) throw new Error(`OpenSky returned ${response.status}`);
  const osData = await response.json();
  const flights = [];
  for (const s of osData.states || []) {
    if (s[5] == null || s[6] == null) continue;
    const alt = s[7] || 0;
    if (alt < 50 && (s[9] || 0) < 5) continue;
    flights.push({
      id: s[0],
      callsign: (s[1] || '').trim() || s[0],
      country: s[2] || 'Unknown',
      lat: s[6],
      lon: s[5],
      track: s[10] || 0,
      alt,
      velocity: s[9] || 0,
      isMilitary: false,
      source: 'opensky',
      onGround: !!s[8]
    });
  }
  return flights;
}

async function fetchFR24(fetch) {
  const response = await fetch('https://data-cloud.flightradar24.com/zones/fcgi/feed.js?bounds=90,-90,-180,180&faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=0&air=1&vehicles=0&estimated=1&maxage=300&gliders=0&stats=0', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    },
    timeout: 12000
  });
  if (!response.ok) throw new Error(`FlightRadar24 returned ${response.status}`);
  const data = await response.json();
  const flights = [];
  for (const key in data) {
    const f = data[key];
    if (!Array.isArray(f) || f.length < 10) continue;
    const altFt = f[4];
    if (altFt == null || altFt < 100) continue;
    flights.push({
      id: String(f[0] || key),
      callsign: f[16] || f[9] || 'Unknown',
      country: f[11] ? `${f[11]} → ${f[12]}` : 'Unknown',
      lat: f[1],
      lon: f[2],
      track: f[3] || 0,
      alt: altFt * FEET_TO_M,
      velocity: (f[5] || 0) * KNOTS_TO_MS,
      isMilitary: false,
      source: 'flightradar24'
    });
  }
  return flights;
}

async function fetchCivilian(source, fetchWithTimeout, fetch, log) {
  if (source === 'fr24') return fetchFR24(fetch);
  if (source === 'opensky') return fetchOpenSky(fetchWithTimeout, log);
  try {
    return await fetchFR24(fetch);
  } catch {
    log('FR24 unavailable, falling back to OpenSky...', 'FLIGHTS');
    return fetchOpenSky(fetchWithTimeout, log);
  }
}

function mergeFlights(civilian, military) {
  const byId = new Map();
  civilian.forEach((f) => byId.set(f.id, f));
  military.forEach((f) => byId.set(f.id, f));
  return Array.from(byId.values());
}

function createFlightFeed({ fetchWithTimeout, fetch, log }) {
  const REFRESH_MS = 5000;
  let state = {
    flights: [],
    timestamp: 0,
    civilian: 0,
    military: 0,
    source: 'auto',
    refreshing: false,
    lastError: null
  };

  async function refresh(source = state.source) {
    if (state.refreshing) return state;
    state.refreshing = true;
    state.source = source;
    try {
      const [civResult, milResult] = await Promise.allSettled([
        fetchCivilian(source, fetchWithTimeout, fetch, log),
        fetchAdsbMilitary(fetchWithTimeout, log)
      ]);

      const civilian = civResult.status === 'fulfilled' ? civResult.value : [];
      const military = milResult.status === 'fulfilled' ? milResult.value : [];

      if (civResult.status === 'rejected' && milResult.status === 'rejected') {
        throw new Error(`${civResult.reason?.message}; ${milResult.reason?.message}`);
      }

      state.flights = mergeFlights(civilian, military);
      state.civilian = civilian.length;
      state.military = military.length;
      state.timestamp = Date.now();
      state.lastError = null;
      log(`Live feed: ${state.flights.length} aircraft (${state.civilian} civ + ${state.military} mil)`, 'FLIGHTS');
    } catch (err) {
      state.lastError = err.message;
      log(`Flight feed error: ${err.message}`, 'FLIGHTS');
    } finally {
      state.refreshing = false;
    }
    return state;
  }

  refresh('auto');
  const timer = setInterval(() => refresh(state.source), REFRESH_MS);

  return {
    getState: () => state,
    refresh,
    stop: () => clearInterval(timer)
  };
}

module.exports = {
  createFlightFeed,
  fetchCivilian,
  fetchAdsbMilitary,
  mergeFlights
};
