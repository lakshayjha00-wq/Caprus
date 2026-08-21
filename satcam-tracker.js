/**
 * GODSEYE — Satellite Camera & Observation Feed tracker
 * Connects to live space feeds, tracks ISS in real-time, and integrates geostationary cameras.
 */
(function () {
  'use strict';

  // Live video streams configuration
  const STREAMS = {
    iss_earth: {
      name: "ISS Live — Earth Views 🌍",
      url: "https://www.youtube-nocookie.com/embed/live_stream?channel=UCrn791W1HkGv_kQo5_H5YfQ&autoplay=1&mute=1"
    },
    nasa_tv: {
      name: "NASA TV Live Feed 🛰️",
      url: "https://www.youtube-nocookie.com/embed/live_stream?channel=UCoS3J2ISvZyGt1c5SAD87_w&autoplay=1&mute=1"
    },
    iss_crew: {
      name: "ISS Crew & Cabin Feed 👨‍🚀",
      url: "https://www.youtube.com/embed/P9C25Un7xaM?autoplay=1&mute=1"
    },
    custom: {
      name: "Custom YouTube ID 🛠️",
      url: ""
    }
  };

  // Custom SVG data URL for the ISS billboard
  const ISS_ICON_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="48" height="48">
    <path d="M12,32 H52 M32,12 V52" stroke="%2300d4ff" stroke-width="4" stroke-linecap="round"/>
    <rect x="6" y="16" width="6" height="32" rx="2" fill="%234a9eff" stroke="%2300d4ff" stroke-width="1.5"/>
    <rect x="52" y="16" width="6" height="32" rx="2" fill="%234a9eff" stroke="%2300d4ff" stroke-width="1.5"/>
    <circle cx="32" cy="32" r="8" fill="%23e8ecf4" stroke="%238b92a5" stroke-width="2"/>
    <rect x="22" y="29" width="20" height="6" rx="2" fill="%23cbd5e1" stroke="%238b92a5" stroke-width="1.5"/>
    <rect x="18" y="6" width="5" height="15" rx="1" fill="%23555d75"/>
    <rect x="41" y="6" width="5" height="15" rx="1" fill="%23555d75"/>
    <rect x="18" y="43" width="5" height="15" rx="1" fill="%23555d75"/>
    <rect x="41" y="43" width="5" height="15" rx="1" fill="%23555d75"/>
  </svg>`;

  let issEntity = null;
  let issFovEntity = null;
  let isCameraLocked = false;
  let issPollInterval = null;
  let lastGeocodeTime = 0;
  let currentRegion = "Unknown Region";
  let lastLat = 0;
  let lastLon = 0;

  function getViewer() {
    return window.viewer;
  }

  // Render HTML structure inside the tab panel
  function initializeUI() {
    const container = document.getElementById('intel-panel-satcams');
    if (!container) return;

    container.innerHTML = `
      <!-- Live Video Feed Section -->
      <h3 class="satcam-section-title">Satellite Live Camera</h3>
      <div class="satcam-selector-wrapper">
        <select id="satcamFeedSelect" class="satcam-select">
          ${Object.entries(STREAMS).map(([key, val]) => `<option value="${key}">${val.name}</option>`).join('')}
        </select>
        <div id="satcamCustomInputWrapper" class="satcam-input-custom" style="display: none;">
          <input type="text" id="satcamCustomId" class="satcam-input" placeholder="YouTube Video ID (e.g., jPTD2gnZFUw)">
          <button id="satcamApplyCustom" class="satcam-btn satcam-btn-primary">Apply</button>
        </div>
      </div>
      
      <div class="satcam-stream-container">
        <iframe id="satcamPlayer" src="${STREAMS.iss_earth.url}" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        <div id="satcamFallback" class="satcam-fallback" style="display:none; margin-top:8px;">
          <span>Video unavailable. <a id="satcamOpenLink" href="#" target="_blank">Open on YouTube</a></span>
        </div>
      </div>

      <!-- Telemetry Dashboard Section -->
      <h3 class="satcam-section-title">ISS Orbit & Telemetry</h3>
      <div class="satcam-telemetry-card">
        <div class="satcam-telemetry-row">
          <span>Flyover Zone</span>
          <span id="issTelemetryRegion" class="highlight-cyan">Calculating...</span>
        </div>
        <div class="satcam-telemetry-row">
          <span>Latitude</span>
          <span id="issTelemetryLat">—</span>
        </div>
        <div class="satcam-telemetry-row">
          <span>Longitude</span>
          <span id="issTelemetryLon">—</span>
        </div>
        <div class="satcam-telemetry-row">
          <span>Altitude</span>
          <span id="issTelemetryAlt" class="highlight-cyan">—</span>
        </div>
        <div class="satcam-telemetry-row">
          <span>Orbital Speed</span>
          <span id="issTelemetrySpeed" class="highlight-cyan">—</span>
        </div>
        <div class="satcam-telemetry-row">
          <span>Last Update</span>
          <span id="issTelemetryTime">—</span>
        </div>
      </div>

      <div class="satcam-controls">
        <button id="btnCenterISS" class="satcam-btn satcam-btn-primary">🎯 Center Map</button>
        <button id="btnLockISS" class="satcam-btn">🛰️ Lock Camera</button>
      </div>

      <!-- DSCOVR EPIC Image Section -->
      <h3 class="satcam-section-title">DSCOVR Deep Space Camera</h3>
      <div id="dscovrContainer" class="satcam-telemetry-card" style="padding: 10px;">
        <div class="intel-empty" style="padding: 10px 0;">Querying NASA L1 Camera...</div>
      </div>
    `;

    // Bind event listeners
    const select = document.getElementById('satcamFeedSelect');
    const customWrapper = document.getElementById('satcamCustomInputWrapper');
    const player = document.getElementById('satcamPlayer');
    const fallback = document.getElementById('satcamFallback');

    if (player && fallback) {
      player.addEventListener('error', () => {
        fallback.style.display = 'block';
        const src = player.src;
        const match = src.match(/embed\/([^?&]+)/);
        const videoId = match ? match[1] : '';
        const link = document.getElementById('satcamOpenLink');
        if (link && videoId) {
          link.href = `https://www.youtube.com/watch?v=${videoId}`;
        }
      });
    }

    select.addEventListener('change', () => {
      const val = select.value;
      if (val === 'custom') {
        customWrapper.style.display = 'flex';
      } else {
        customWrapper.style.display = 'none';
        const stream = STREAMS[val];
        if (stream && stream.url) {
          player.src = stream.url;
        }
      }
    });

    document.getElementById('satcamApplyCustom').addEventListener('click', () => {
      const customId = document.getElementById('satcamCustomId').value.trim();
      if (customId) {
        player.src = `https://www.youtube.com/embed/${customId}?autoplay=1&mute=1`;
      }
    });

    document.getElementById('btnCenterISS').addEventListener('click', () => {
      flyToISS();
    });

    const lockBtn = document.getElementById('btnLockISS');
    lockBtn.addEventListener('click', () => {
      const viewer = getViewer();
      if (!viewer || !issEntity) return;

      isCameraLocked = !isCameraLocked;
      if (isCameraLocked) {
        viewer.trackedEntity = issEntity;
        lockBtn.classList.add('satcam-btn-active');
        lockBtn.textContent = "🔒 Locked to ISS";
      } else {
        viewer.trackedEntity = undefined;
        lockBtn.classList.remove('satcam-btn-active');
        lockBtn.textContent = "🛰️ Lock Camera";
      }
    });
  }

  // Poll real-time ISS location
  async function pollISSLocation() {
    try {
      const res = await fetch('https://api.open-notify.org/iss-now.json');
      if (!res.ok) throw new Error('Failed to fetch ISS coordinates');
      const data = await res.json();
      
      if (data.message === 'success' && data.iss_position) {
        const lat = parseFloat(data.iss_position.latitude);
        const lon = parseFloat(data.iss_position.longitude);
        const altM = 420000; // 420 km standard ISS altitude
        const time = new Date(data.timestamp * 1000);

        lastLat = lat;
        lastLon = lon;

        // Update UI Telemetry
        document.getElementById('issTelemetryLat').textContent = lat.toFixed(4) + '°';
        document.getElementById('issTelemetryLon').textContent = lon.toFixed(4) + '°';
        document.getElementById('issTelemetryAlt').textContent = "418.5 km (Low Earth Orbit)";
        document.getElementById('issTelemetrySpeed').textContent = "27,560 km/h (7.66 km/s)";
        document.getElementById('issTelemetryTime').textContent = time.toLocaleTimeString();

        // Update Cesium Overlays
        updateCesiumIssOverlay(lat, lon, altM);

        // Periodically Geocode Flyover Location
        const now = Date.now();
        if (now - lastGeocodeTime > 12000) {
          lastGeocodeTime = now;
          geocodeFlyover(lat, lon);
        }
      }
    } catch (err) {
      console.warn('[SATCAM] ISS Polling Error:', err.message);
    }
  }

  // Geocode current ground position of ISS
  async function geocodeFlyover(lat, lon) {
    try {
      const res = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error('Geocode failed');
      const data = await res.json();
      
      let locName = "Over Open Water / Ocean";
      if (data.address) {
        const addr = data.address;
        const country = addr.country || addr.state || "";
        const county = addr.county || addr.city || addr.suburb || "";
        if (county && country) locName = `${county}, ${country}`;
        else if (country) locName = country;
      }
      
      currentRegion = locName;
      const el = document.getElementById('issTelemetryRegion');
      if (el) {
        el.textContent = currentRegion;
        if (locName.includes('Ocean') || locName.includes('Water')) {
          el.className = "highlight-cyan";
        } else {
          el.className = "highlight-green";
        }
      }
    } catch {
      // Nominatim might 404 or return empty over oceans
      const el = document.getElementById('issTelemetryRegion');
      if (el) el.textContent = "Over Open Water / Ocean";
    }
  }

  // Update Cesium primitives/entities
  function updateCesiumIssOverlay(lat, lon, altM) {
    const viewer = getViewer();
    if (!viewer) return;

    const position3D = Cesium.Cartesian3.fromDegrees(lon, lat, altM);
    const positionGround = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

    if (!issEntity) {
      // Create ISS satellite model/billboard entity
      issEntity = viewer.entities.add({
        id: 'iss-satellite',
        name: 'ISS (Space Camera Platform)',
        position: position3D,
        billboard: {
          image: ISS_ICON_SVG,
          scale: 0.8,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        path: {
          resolution: 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.1,
            color: Cesium.Color.fromCssColorString('#00d4ff')
          }),
          width: 3.5,
          leadTime: 0,
          trailTime: 1800 // Show 30 mins path history
        },
        properties: {
          isISS: true
        }
      });

      // Create ground field of view shadow
      issFovEntity = viewer.entities.add({
        id: 'iss-fov',
        name: 'ISS Ground Camera Sweep',
        position: positionGround,
        ellipse: {
          semiMajorAxis: 750000, // 750 km footprint diameter
          semiMinorAxis: 750000,
          material: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.1),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.55),
          outlineWidth: 1.5,
          height: 0
        }
      });
    } else {
      // Update entity position values
      issEntity.position.setValue(position3D);
      issFovEntity.position.setValue(positionGround);
    }
  }

  // Centering camera function
  function flyToISS() {
    const viewer = getViewer();
    if (!viewer || lastLat === 0) return;
    
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lastLon, lastLat, 950000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0
      },
      duration: 2
    });
  }

  // Query NASA DSCOVR EPIC API
  async function loadDscovrEpicImage() {
    const wrapper = document.getElementById('dscovrContainer');
    if (!wrapper) return;

    try {
      const res = await fetch('https://epic.gsfc.nasa.gov/api/natural');
      if (!res.ok) throw new Error('NASA API unavailable');
      const data = await res.json();
      
      if (!data || !data.length) {
        wrapper.innerHTML = '<div class="intel-empty">No daily NASA images available.</div>';
        return;
      }

      const item = data[0]; // Get most recent full-disk capture
      const date = item.date; // Format: "YYYY-MM-DD HH:MM:SS"
      const dateParts = date.split(' ')[0].split('-'); // ["YYYY", "MM", "DD"]
      const imgName = item.image;
      const imgUrl = `https://epic.gsfc.nasa.gov/archive/natural/${dateParts[0]}/${dateParts[1]}/${dateParts[2]}/png/${imgName}.png`;
      const lat = item.coords.centroid_coordinates.lat;
      const lon = item.coords.centroid_coordinates.lon;

      wrapper.innerHTML = `
        <div style="font-size: 11px; font-weight: 700; color: var(--accent-cyan); margin-bottom: 6px;">
          📸 L1 Lagrange Centroid View
        </div>
        <img src="${imgUrl}" class="satcam-dscovr-img" alt="NASA DSCOVR EPIC Earth View" />
        <div style="font-size: 10px; color: var(--text-secondary); line-height: 1.4; margin-bottom: 8px;">
          Captured: ${date} UTC<br>
          Centroid: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°
        </div>
        <button id="btnAlignDscovr" class="satcam-btn satcam-btn-primary" style="width: 100%;">
          🌍 Align Globe to Centroid
        </button>
      `;

      document.getElementById('btnAlignDscovr').addEventListener('click', () => {
        const viewer = getViewer();
        if (!viewer) return;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 16000000), // view full globe from space
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-90),
            roll: 0
          },
          duration: 2.5
        });
      });

    } catch (err) {
      console.warn('[SATCAM] NASA EPIC Fetch Error:', err.message);
      wrapper.innerHTML = `<div class="intel-empty" style="color: var(--accent-red);">NASA L1 Camera offline.</div>`;
    }
  }

  // Module initialization on load
  function boot() {
    const checkReady = setInterval(() => {
      const viewer = getViewer();
      if (!viewer || typeof Cesium === 'undefined') return;
      clearInterval(checkReady);

      // Render tab layout & inputs
      initializeUI();
      
      // Start ISS polling loop
      pollISSLocation();
      issPollInterval = setInterval(pollISSLocation, 5000);

      // Fetch NASA EPIC image
      loadDscovrEpicImage();

      console.info('[SATCAM] Satellite feeds and telemetry active');
    }, 300);
  }

  // Trigger boot appropriately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
