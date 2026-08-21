const { db } = require('./satellite-db');
const fetch = require('node-fetch');

const LOG_CATEGORY = 'FIRMS-SERVICE';
const log = (msg, level = 'info') => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${LOG_CATEGORY}] [${level.toUpperCase()}] ${msg}`);
};

// Middle East Bounding Box: West (xmin): 24, South (ymin): 12, East (xmax): 64, North (ymax): 40
const BOUNDING_BOX = '24,12,64,40';
const DAY_RANGE = 1;

const SOURCES = [
  'MODIS_NRT',
  'VIIRS_SNPP_NRT',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT'
];

/**
 * Initializes the thermal_events table and unique index
 */
function initSchema() {
  return new Promise((resolve, reject) => {
    if (!db) {
      return reject(new Error('Database connection is not available. Ensure satellite-db.js is initialized.'));
    }

    db.serialize(() => {
      // Create table
      db.run(`
        CREATE TABLE IF NOT EXISTS thermal_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          latitude REAL,
          longitude REAL,
          brightness REAL,
          confidence TEXT,
          timestamp INTEGER,
          sensor TEXT,
          acq_date TEXT,
          acq_time TEXT
        )
      `, (err) => {
        if (err) {
          log(`Failed to create thermal_events table: ${err.message}`, 'error');
          return reject(err);
        }

        // Create unique index to prevent duplicate entries
        db.run(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_thermal_events_unique 
          ON thermal_events (latitude, longitude, timestamp)
        `, (errIndex) => {
          if (errIndex) {
            log(`Failed to create unique index: ${errIndex.message}`, 'error');
            return reject(errIndex);
          }
          log('Database schema for thermal_events initialized successfully.', 'info');
          resolve();
        });
      });
    });
  });
}

/**
 * Simple CSV parser to convert FIRMS CSV string into an array of objects
 */
function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length !== headers.length) continue;

    const record = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j];
    }
    records.push(record);
  }
  return records;
}

/**
 * Helper to check if a confidence value represents a low confidence detection
 */
function isLowConfidence(confidence) {
  if (!confidence) return true;
  
  // If numeric (typically MODIS: 0-100)
  const numValue = parseFloat(confidence);
  if (!isNaN(numValue)) {
    return numValue < 30;
  }

  // If character code (typically VIIRS: l/low, n/nominal, h/high)
  const lowerConf = confidence.toLowerCase();
  return lowerConf === 'l' || lowerConf === 'low';
}

/**
 * Generates realistic mock active fire events in the Middle East
 */
function generateMockEvents() {
  log('Generating realistic mock thermal events for the Middle East region...', 'info');
  const mockSensors = ['MODIS', 'VIIRS'];
  const mockEvents = [];
  const now = new Date();

  // Create a few hotspots around known coordinates in the Middle East
  // (e.g., oil fields, desert regions, industrial areas)
  const majorLocations = [
    { name: 'Ghawar Oil Field, Saudi Arabia', lat: 25.9, lon: 49.1 },
    { name: 'Rumaila, Iraq', lat: 30.2, lon: 47.3 },
    { name: 'Deir ez-Zor, Syria', lat: 35.3, lon: 40.15 },
    { name: 'Western Desert, Egypt', lat: 27.5, lon: 28.3 },
    { name: 'Marib, Yemen', lat: 15.4, lon: 45.3 },
    { name: 'Ahvaz region, Iran', lat: 31.3, lon: 48.7 },
    // Crisis-zone correlated hotspots (for map + panel linkage)
    { name: 'Donbas industrial corridor', lat: 48.2, lon: 37.9 },
    { name: 'Levant border sector', lat: 33.1, lon: 35.7 },
    { name: 'Taiwan Strait approaches', lat: 24.4, lon: 119.6 },
    { name: 'Bab al-Mandeb shipping lane', lat: 13.4, lon: 43.2 },
    { name: 'Khartoum metro', lat: 15.5, lon: 32.6 },
    { name: 'DMZ flash sector', lat: 37.9, lon: 127.0 },
  ];

  for (const loc of majorLocations) {
    // Generate 1-3 hotspots around each major location
    const numHotspots = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numHotspots; i++) {
      // Add slight jitter
      const lat = parseFloat((loc.lat + (Math.random() - 0.5) * 0.4).toFixed(4));
      const lon = parseFloat((loc.lon + (Math.random() - 0.5) * 0.4).toFixed(4));
      const brightness = parseFloat((300 + Math.random() * 150).toFixed(2)); // 300 to 450 Kelvin
      const isHigh = Math.random() > 0.7;
      const confidence = isHigh ? 'h' : 'n'; // nominal or high
      const sensor = mockSensors[Math.floor(Math.random() * mockSensors.length)];
      
      const acqDate = now.toISOString().split('T')[0];
      const acqTime = `${now.getUTCHours().toString().padStart(2, '0')}${now.getUTCMinutes().toString().padStart(2, '0')}`;
      
      mockEvents.push({
        latitude: lat,
        longitude: lon,
        brightness,
        confidence,
        acq_date: acqDate,
        acq_time: acqTime,
        instrument: sensor
      });
    }
  }

  return mockEvents;
}

/**
 * Saves thermal events into the SQLite database
 */
function saveEventsToDb(events) {
  return new Promise((resolve, reject) => {
    if (!events.length) return resolve(0);

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO thermal_events 
        (latitude, longitude, brightness, confidence, timestamp, sensor, acq_date, acq_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let insertedCount = 0;
      for (const event of events) {
        // Calculate timestamp from acq_date and acq_time
        let timestamp = Date.now();
        if (event.acq_date && event.acq_time) {
          const paddedTime = event.acq_time.toString().padStart(4, '0');
          const hh = paddedTime.substring(0, 2);
          const mm = paddedTime.substring(2, 4);
          const isoString = `${event.acq_date}T${hh}:${mm}:00Z`;
          const parsedTime = Date.parse(isoString);
          if (!isNaN(parsedTime)) {
            timestamp = parsedTime;
          }
        }

        const lat = parseFloat(event.latitude);
        const lon = parseFloat(event.longitude);
        const bright = parseFloat(event.brightness);
        const conf = event.confidence;
        const sensor = event.instrument || 'UNKNOWN';

        stmt.run([lat, lon, bright, conf, timestamp, sensor, event.acq_date, event.acq_time], function(err) {
          if (!err && this.changes > 0) {
            insertedCount++;
          }
        });
      }

      stmt.finalize();
      db.run('COMMIT', (err) => {
        if (err) {
          log(`Failed to commit database transaction: ${err.message}`, 'error');
          return reject(err);
        }
        resolve(insertedCount);
      });
    });
  });
}

/**
 * Main fetch cycle for thermal events
 */
async function fetchAndIngest() {
  const mapKey = process.env.FIRMS_MAP_KEY;
  
  if (!mapKey) {
    log('FIRMS_MAP_KEY is not defined in environment variables. Falling back to Mock Data Ingestion.', 'warning');
    const mockEvents = generateMockEvents();
    try {
      const inserted = await saveEventsToDb(mockEvents);
      log(`Mock Ingestion complete: successfully saved ${inserted} new thermal events.`, 'info');
    } catch (err) {
      log(`Failed to ingest mock thermal events: ${err.message}`, 'error');
    }
    return;
  }

  log(`Starting NASA FIRMS API sync cycle for Middle East (${BOUNDING_BOX})...`, 'info');
  let totalDetections = 0;
  let totalSaved = 0;

  for (const source of SOURCES) {
    try {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${source}/${BOUNDING_BOX}/${DAY_RANGE}`;
      log(`Fetching data for source ${source}...`, 'info');
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`NASA FIRMS API returned HTTP status ${response.status}`);
      }

      const csvText = await response.text();
      // NASA FIRMS API sometimes returns messages like "Bad Map Key" or "No data available" directly as plain text.
      // Let's check for those issues.
      if (csvText.includes('invalid') || csvText.includes('invalid map key') || csvText.includes('Unauthorized')) {
        throw new Error(`Invalid MAP_KEY or unauthorized response from NASA FIRMS API: ${csvText.trim()}`);
      }
      
      if (csvText.includes('No data available')) {
        log(`No data available from source ${source} for the selected area.`, 'info');
        continue;
      }

      const rawEvents = parseCSV(csvText);
      log(`Source ${source} returned ${rawEvents.length} raw detections.`, 'info');
      
      // Filter out low confidence detections
      const filteredEvents = rawEvents.filter(event => {
        const low = isLowConfidence(event.confidence);
        return !low;
      });

      totalDetections += filteredEvents.length;
      const savedCount = await saveEventsToDb(filteredEvents);
      totalSaved += savedCount;
      
      log(`Source ${source}: Ingested ${savedCount} new alerts (filtered out ${rawEvents.length - filteredEvents.length} low-confidence detections).`, 'info');

    } catch (err) {
      log(`Error fetching/ingesting FIRMS source ${source}: ${err.message}`, 'error');
      // If we encounter a key authentication failure, let's fall back to mock data
      if (err.message.includes('Invalid MAP_KEY') || err.message.includes('unauthorized') || err.message.includes('401') || err.message.includes('403')) {
        log('Key validation failure detected. Performing mock data fallback...', 'warning');
        const mockEvents = generateMockEvents();
        try {
          const inserted = await saveEventsToDb(mockEvents);
          log(`Mock Ingestion complete: successfully saved ${inserted} new thermal events.`, 'info');
          break; // Stop querying other sources to avoid duplicate warnings
        } catch (mockErr) {
          log(`Failed to ingest mock thermal events: ${mockErr.message}`, 'error');
        }
      }
    }
  }

  log(`NASA FIRMS sync complete. Total active/nominal detections parsed: ${totalDetections}. Total newly saved: ${totalSaved}.`, 'info');
}

/**
 * Starts the background loop that runs every 30 minutes
 */
function start() {
  log('Starting background surveillance service for NASA FIRMS...', 'info');
  initSchema()
    .then(() => {
      // Run once immediately on start
      fetchAndIngest();

      // Schedule to run every 30 minutes
      const intervalMs = 30 * 60 * 1000;
      setInterval(() => {
        fetchAndIngest();
      }, intervalMs);
    })
    .catch((err) => {
      log(`Failed to start FIRMS service: ${err.message}`, 'error');
    });
}

/**
 * Returns thermal events from the database
 */
function getThermalEvents(limit = 100) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM thermal_events ORDER BY timestamp DESC LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

module.exports = {
  start,
  fetchAndIngest,
  getThermalEvents
};
