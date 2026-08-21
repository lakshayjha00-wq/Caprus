/* ═══════════════════════════════════════════════════════════════
   MASSIVE SATELLITE TRACKER — High Performance Module
   Uses Cesium PointPrimitiveCollection & satellite.js to 
   handle 14,000+ objects simultaneously without crashing.
   ═══════════════════════════════════════════════════════════════ */

(function(viewer) {
  'use strict';

  if (!viewer) {
    console.error('❌ SatTracker: No Cesium viewer found!');
    return;
  }

  console.log('🛰️ SatTracker: Initializing MASSIVE orbital tracking system...');

  // ─── State ───
  let satData = {};       // raw data by ID
  let satrecs = [];
  let satPoints = [];
  let satInterval = null;
  let xyzGridEntities = [];
  let selectedNoradId = null;
  let selectedOrbitEntity = null;
  let highlightedPoint = null;
  let highlightedPointSize = null;

  const MU_EARTH = 398600.4418;
  const EARTH_RADIUS_KM = 6378.137;

  const TYPE_LABELS = {
    MILITARY: '⚔️ Military / Recon',
    TELECOM: '📡 Telecommunications',
    WEATHER: '🌤️ Meteorological',
    SCIENTIFIC: '🔬 Scientific / EO',
    SPACE_STATION: '🛰️ Space Station',
    COMMERCIAL: '💎 Commercial / LEO'
  };

  const satellitePopup = document.getElementById('satellitePopup');
  const satPopupTitle = document.getElementById('satPopupTitle');
  const satPopupBadge = document.getElementById('satPopupBadge');
  const satPopupDetails = document.getElementById('satPopupDetails');
  const satPopupFlyTo = document.getElementById('satPopupFlyTo');

  // High performance primitive collection
  const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  points.blendOption = Cesium.BlendOption.OPAQUE; // Faster rendering
  points.show = false;

  // ─── Color Palette ───
  const SAT_STYLES = {
    SPACE_STATION: { color: '#fcd34d', size: 4 },
    MILITARY:      { color: '#ef4444', size: 3 },
    TELECOM:       { color: '#3b82f6', size: 2 },
    WEATHER:       { color: '#10b981', size: 2 },
    SCIENTIFIC:    { color: '#a855f7', size: 2 },
    COMMERCIAL:    { color: '#38bdf8', size: 2 }
  };

  function enrichFromSatrec(s, satrec) {
    const nRadPerMin = satrec.no;
    const nRadPerSec = nRadPerMin / 60;
    const periodMin = (2 * Math.PI) / nRadPerMin;
    const aKm = Math.pow(MU_EARTH / (nRadPerSec * nRadPerSec), 1 / 3);
    const ecc = satrec.ecco;
    const inclDeg = satrec.inclo * 180 / Math.PI;

    s.inclination = inclDeg.toFixed(2);
    s.period_min = periodMin.toFixed(1);
    s.eccentricity = ecc.toFixed(6);
    s.apogee_km = Math.round(aKm * (1 + ecc) - EARTH_RADIUS_KM);
    s.perigee_km = Math.round(aKm * (1 - ecc) - EARTH_RADIUS_KM);
    s.satrec = satrec;

    if (s.tle1 && s.tle1.length >= 32) {
      s.tle_epoch = s.tle1.substring(18, 32).trim();
    }
  }

  function getLiveVelocityKms(satrec) {
    try {
      const pv = satellite.propagate(satrec, new Date());
      if (!pv.velocity || typeof pv.velocity === 'boolean') return null;
      const v = pv.velocity;
      return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    } catch {
      return null;
    }
  }

  function computeOrbitPath(satrec, samples = 150) {
    const periodMin = (2 * Math.PI) / satrec.no;
    const periodMs = periodMin * 60 * 1000;
    const startTime = new Date();
    const positions = [];

    for (let i = 0; i <= samples; i++) {
      const t = new Date(startTime.getTime() + (periodMs * i) / samples);
      const gmst = satellite.gstime(t);
      const result = satellite.propagate(satrec, t);
      if (result.position && typeof result.position !== 'boolean') {
        const gd = satellite.eciToGeodetic(result.position, gmst);
        const altM = gd.height * 1000;
        if (altM > 0) {
          positions.push(Cesium.Cartesian3.fromDegrees(
            satellite.degreesLong(gd.longitude),
            satellite.degreesLat(gd.latitude),
            altM
          ));
        }
      }
    }
    return positions;
  }

  function renderSatellitePanel(s) {
    const style = SAT_STYLES[s.type] || SAT_STYLES.COMMERCIAL;
    const velocity = s.satrec ? getLiveVelocityKms(s.satrec) : null;

    satPopupTitle.textContent = s.name || `NORAD ${s.norad_id}`;
    satPopupBadge.textContent = TYPE_LABELS[s.type] || '🛰️ Orbital Satellite';
    satPopupBadge.style.color = style.color;
    satPopupBadge.style.borderColor = style.color + '55';
    satPopupBadge.style.background = style.color + '22';

    const rows = [
      ['NORAD ID', `#${s.norad_id}`],
      ['Latitude', s.lat != null ? `${s.lat.toFixed(4)}°` : '—'],
      ['Longitude', s.lon != null ? `${s.lon.toFixed(4)}°` : '—'],
      ['Altitude', s.alt_km != null ? `${s.alt_km} km` : '—'],
      ['Velocity', velocity != null ? `${velocity.toFixed(2)} km/s` : '—'],
      ['Inclination', s.inclination ? `${s.inclination}°` : '—'],
      ['Eccentricity', s.eccentricity || '—'],
      ['Orbital Period', s.period_min ? `${s.period_min} min` : '—'],
      ['Apogee', s.apogee_km != null ? `${s.apogee_km} km` : '—'],
      ['Perigee', s.perigee_km != null ? `${s.perigee_km} km` : '—'],
      ['TLE Epoch', s.tle_epoch || '—'],
    ];

    satPopupDetails.innerHTML = rows.map(([label, value]) => `
      <div class="popup-row"><span>${label}</span><span>${value}</span></div>
    `).join('') + (s.tle1 && s.tle2 ? `
      <div class="tle-block">${s.tle1}<br>${s.tle2}</div>
    ` : '');

    satPopupFlyTo.onclick = () => {
      if (s.lon == null || s.lat == null) return;
      const alt = (s.alt_km || 400) * 1000;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, alt * 2.5 + 800000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
        duration: 2.5
      });
    };

    satellitePopup.classList.remove('hidden');
  }

  function clearSatelliteSelection() {
    if (selectedOrbitEntity) {
      viewer.entities.remove(selectedOrbitEntity);
      selectedOrbitEntity = null;
    }
    if (highlightedPoint && highlightedPointSize != null) {
      highlightedPoint.pixelSize = highlightedPointSize;
      highlightedPoint = null;
      highlightedPointSize = null;
    }
    selectedNoradId = null;
    if (satellitePopup) satellitePopup.classList.add('hidden');
    viewer.scene.requestRender();
  }

  function selectSatellite(noradId) {
    const s = satData[noradId];
    const entry = satrecs.find((r) => r.id === noradId);
    if (!s || !entry) return;

    clearSatelliteSelection();
    window.clearFlightSelection?.();
    selectedNoradId = noradId;

    const style = SAT_STYLES[s.type] || SAT_STYLES.COMMERCIAL;
    const orbitPositions = computeOrbitPath(entry.satrec);

    if (orbitPositions.length > 1) {
      selectedOrbitEntity = viewer.entities.add({
        polyline: {
          positions: orbitPositions,
          width: 2.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15,
            color: Cesium.Color.fromCssColorString(style.color).withAlpha(0.9)
          }),
          arcType: Cesium.ArcType.NONE
        }
      });

      const sphere = Cesium.BoundingSphere.fromPoints(orbitPositions);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 2,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), sphere.radius * 2.8)
      });
    }

    const idx = satrecs.findIndex((r) => r.id === noradId);
    if (idx >= 0 && satPoints[idx]) {
      highlightedPoint = satPoints[idx];
      highlightedPointSize = highlightedPoint.pixelSize;
      highlightedPoint.pixelSize = (highlightedPointSize || 2) * 2.5;
    }

    renderSatellitePanel(s);
    viewer.scene.requestRender();
  }

  function getSatIdFromPick(picked) {
    if (!picked) return null;
    return picked.primitive?._satId || picked.id?._satId || null;
  }

  // ─── Fetch & Parse ───
  async function loadMassiveDatabase() {
    try {
      console.log("📡 Fetching massive database from SQLite backend...");
      const res = await fetch('/api/massive-tle');
      const data = await res.json();
      
      if (!data.satellites || !data.satellites.length) return;

      console.log(`📡 Ingesting ${data.satellites.length} TLEs into physics engine...`);
      points.removeAll();
      satrecs = [];
      satPoints = [];
      satData = {};

      for (let i = 0; i < data.satellites.length; i++) {
        const s = data.satellites[i];
        // Skip duplicate ISS objects (e.g., "ISS OBJECT XY")
        if (s.name && s.name.includes('ISS OBJECT') && s.type === 'SPACE_STATION') {
          continue;
        }
        try {
          const satrec = satellite.twoline2satrec(s.tle1, s.tle2);
          if (satrec) {
            s.norad_id = String(s.norad_id);
            enrichFromSatrec(s, satrec);
            satData[s.norad_id] = s;
            satrecs.push({ satrec, id: s.norad_id });
            
            const style = SAT_STYLES[s.type] || SAT_STYLES.COMMERCIAL;
            const cesiumColor = Cesium.Color.fromCssColorString(style.color);

            const p = points.add({
              position: Cesium.Cartesian3.fromDegrees(0, 0, 0), // dummy
              pixelSize: style.size,
              color: cesiumColor,
            });
            p._satId = s.norad_id; // Attach ID directly to primitive for hovering
            satPoints.push(p);
          }
        } catch(e) {
          // Ignore invalid TLEs
        }
      }
      
      console.log(`✅ Loaded ${satrecs.length} valid orbits. Starting propagation...`);
      propagatePositions();
      
      if (document.getElementById('toggleSatellites').checked) {
        points.show = true;
        satInterval = setInterval(propagatePositions, 2000);
      }
      
    } catch (err) {
      console.error('🛰️ SatTracker: Database fetch error:', err);
    }
  }

  // ─── Propagation Loop ───
  function propagatePositions() {
    const now = new Date();
    const gmst = satellite.gstime(now);
    
    for (let i = 0; i < satrecs.length; i++) {
      const sat = satrecs[i];
      const point = satPoints[i];
      
      try {
        const positionAndVelocity = satellite.propagate(sat.satrec, now);
        if (positionAndVelocity.position && typeof positionAndVelocity.position !== 'boolean') {
          const p = positionAndVelocity.position;
          const positionGd = satellite.eciToGeodetic(p, gmst);
          
          const lon = satellite.degreesLong(positionGd.longitude);
          const lat = satellite.degreesLat(positionGd.latitude);
          const altMeters = positionGd.height * 1000;
          
          if (altMeters > 0) {
            point.position = Cesium.Cartesian3.fromDegrees(lon, lat, altMeters);
            point.show = true;
            
            // Update live data for picking/hover popup
            if (satData[sat.id]) {
              satData[sat.id].lat = lat;
              satData[sat.id].lon = lon;
              satData[sat.id].alt_km = Math.round(positionGd.height);
              if (sat.id === selectedNoradId) {
                renderSatellitePanel(satData[sat.id]);
              }
            }
          } else {
            point.show = false;
          }
        } else {
          point.show = false;
        }
      } catch (e) {
        point.show = false;
      }
    }
    viewer.scene.requestRender();
  }

  // ─── Toggle TLEs ───
  function enableSatellites() {
    points.show = true;
    if (satrecs.length === 0) {
      loadMassiveDatabase();
    } else {
      propagatePositions();
      satInterval = setInterval(propagatePositions, 2000);
    }
  }

  function disableSatellites() {
    if (satInterval) {
      clearInterval(satInterval);
      satInterval = null;
    }
    clearSatelliteSelection();
    points.show = false;
    viewer.scene.requestRender();
  }

  // ─── XYZ Orbital Reference Grid (Restored) ───
  function buildXYZGrid() {
    const axisLen = 42000000;
    const axes = [
      { lon: 0, lat: 0, color: '#ef4444', label: 'X (0° EQUATOR)', w: 2 },
      { lon: 90, lat: 0, color: '#10b981', label: 'Y (90°E EQUATOR)', w: 2 },
      { lon: 0, lat: 90, color: '#3b82f6', label: 'Z (NORTH POLE)', w: 2 }
    ];

    axes.forEach(ax => {
      const e = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights([ax.lon, ax.lat, 0, ax.lon, ax.lat, axisLen]),
          width: ax.w,
          material: Cesium.Color.fromCssColorString(ax.color).withAlpha(0.6),
          arcType: Cesium.ArcType.NONE
        },
        show: false
      });
      xyzGridEntities.push(e);
    });

    const rings = [{ km: 500 }, { km: 2000 }, { km: 20000 }, { km: 35786 }];
    rings.forEach(r => {
      const altM = r.km * 1000;
      const pts = [];
      for (let d = 0; d <= 360; d += 2) pts.push(d, 0, altM);
      const ring = viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights(pts),
          width: 1.5,
          material: Cesium.Color.WHITE.withAlpha(0.2),
          arcType: Cesium.ArcType.NONE
        },
        show: false
      });
      xyzGridEntities.push(ring);
    });
  }

  function toggleXYZGrid(show) {
    xyzGridEntities.forEach(e => { e.show = show; });
    viewer.scene.requestRender();
  }

  // ─── Expose Global API ───
  window.satTrackerData = satData;
  window.satTrackerPoints = satPoints;
  window.selectSatellite = selectSatellite;
  window.clearSatelliteSelection = clearSatelliteSelection;
  window.getSatIdFromPick = getSatIdFromPick;

  document.getElementById('satellitePopupClose')?.addEventListener('click', clearSatelliteSelection);

  const satToggle = document.getElementById('toggleSatellites');
  if (satToggle) {
    satToggle.addEventListener('change', (e) => e.target.checked ? enableSatellites() : disableSatellites());
  }

  const xyzToggle = document.getElementById('toggleXYZGrid');
  if (xyzToggle) xyzToggle.addEventListener('change', (e) => toggleXYZGrid(e.target.checked));

  buildXYZGrid();
  // We do NOT auto-load 14k immediately on boot to keep the map fast, we wait for the toggle.
  if (satToggle && satToggle.checked) enableSatellites();

})(window.viewer);
