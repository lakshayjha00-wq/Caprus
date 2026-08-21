try {
  process.loadEnvFile();
} catch (err) {
  // If no .env file, ignore
}

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static('public')); // Serve the frontend

const PORT = 3032;
const sqlite3 = require('sqlite3').verbose();
const dbPath = path.join(__dirname, 'satellites.db');

let tleCache = [];
let lastFetch = 0;

async function loadFromLocalDb() {
  console.log('[MASSIVE] Attempting to load satellites from local SQLite database (satellites.db)...');
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('[MASSIVE] Failed to open local database:', err.message);
        resolve([]);
        return;
      }
      db.all("SELECT name, tle1, tle2 FROM satellites", [], (errQuery, rows) => {
        db.close();
        if (errQuery) {
          console.error('[MASSIVE] Failed to query local database:', errQuery.message);
          resolve([]);
          return;
        }
        console.log(`[MASSIVE] Loaded ${rows.length} satellites from local database.`);
        resolve(rows);
      });
    });
  });
}

// Fetch and parse the massive CelesTrak active catalog (TLE format)
async function fetchMassiveCatalog() {
  console.log('[MASSIVE] Fetching active CelesTrak catalog (14,000+ satellites)...');
  try {
    // Dynamic import for node-fetch in case Node version doesn't support global fetch
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    const url = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
    
    // We add a long timeout because 14k text takes time
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`CelesTrak returned HTTP ${response.status}`);
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    
    const satellites = [];
    // TLEs come in 3 lines: Name, Line 1, Line 2
    for (let i = 0; i < lines.length; i += 3) {
      if (lines[i] && lines[i+1] && lines[i+2]) {
        satellites.push({
          name: lines[i],
          tle1: lines[i+1],
          tle2: lines[i+2]
        });
      }
    }
    
    tleCache = satellites;
    lastFetch = Date.now();
    console.log(`[MASSIVE] Success! Ingested ${satellites.length} live satellites.`);
  } catch (err) {
    console.error('[MASSIVE] Failed to fetch catalog:', err.message);
    const localSats = await loadFromLocalDb();
    if (localSats.length > 0) {
      tleCache = localSats;
      lastFetch = Date.now();
      console.log(`[MASSIVE] Fallback success! Loaded ${localSats.length} satellites from local database.`);
    }
  }
}

// Endpoint to stream the raw TLE array to the client
app.get('/api/massive-tle', async (req, res) => {
  // Refresh cache if older than 12 hours
  if (!tleCache.length || Date.now() - lastFetch > 12 * 60 * 60 * 1000) {
    await fetchMassiveCatalog();
  }
  res.json({ count: tleCache.length, satellites: tleCache });
});

// Explicit route for the new standalone UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'massive-tracker.html'));
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Massive Satellite Tracker Backend`);
  console.log(`📡 URL: http://localhost:${PORT}/massive-tracker.html`);
  console.log(`======================================================\n`);
  fetchMassiveCatalog();
});
