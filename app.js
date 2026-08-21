/* ═══════════════════════════════════════════════════════════════
   EARTH 3D GLOBE — Main Application (CesiumJS)
   ═══════════════════════════════════════════════════════════════ */

const loadingScreen = document.getElementById('loadingScreen');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

function setProgress(pct, text) {
  progressFill.style.width = pct + '%';
  progressText.textContent = text;
}

setProgress(10, 'Creating viewer...');

const googleSatelliteImagery = new Cesium.UrlTemplateImageryProvider({
  url: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/tiles/{z}/{x}/{y}.png?lyrs=s',
  credit: 'Google Satellite',
  maximumLevel: 21,
  enablePickFeatures: false,
});

// ─── Cesium Viewer — satellite imagery immediately; 3D upgraded by globe-3d.js ───
const viewer = new Cesium.Viewer('cesiumContainer', {
  imageryProvider: googleSatelliteImagery,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  shadows: false,
  shouldAnimate: true,
  requestRenderMode: false,
  msaaSamples: 2,
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
});
window.viewer = viewer;

const imageryLayers = viewer.imageryLayers;

// Performance tweaks for globe
viewer.scene.globe.maximumScreenSpaceError = 3; // Load slightly lower detail tiles first for faster loading
viewer.scene.globe.tileCacheSize = 1000; // Keep more tiles in memory to prevent reloading

viewer.scene.globe.show = true;
viewer.scene.globe.enableLighting = false;
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#0b132b');
viewer.scene.fog.enabled = true;
viewer.scene.fog.density = 0.0002;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.showGroundAtmosphere = true;
viewer.scene.highDynamicRange = false;
viewer.scene.postProcessStages.fxaa.enabled = true;

let buildingsTileset = null;

async function bootGoogleEarthGlobe() {
  setProgress(30, 'Loading 3D globe...');

  if (typeof window.initGoogleEarthGlobe === 'function') {
    try {
      const initDone = window.initGoogleEarthGlobe(viewer, { setProgress });
      const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
      await Promise.race([initDone, timeout]);
      buildingsTileset = window.getBuildingsTileset?.() || null;
    } catch (err) {
      console.warn('[GLOBE] Globe 3D initialization fallback:', err.message);
    }
  } else {
    console.warn('[GLOBE] globe-3d.js not loaded — satellite layer active');
  }

  setProgress(90, 'Finalizing scene...');

  if (document.getElementById('toggleGrid')?.checked) {
    if (!viewer._gridImagery) {
      viewer._gridImagery = imageryLayers.addImageryProvider(
        new Cesium.GridImageryProvider({
          color: new Cesium.Color(1.0, 1.0, 1.0, 0.15),
          glowWidth: 0,
        })
      );
    }
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 12000000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-55),
      roll: 0,
    },
    duration: 0,
  });

  setProgress(100, 'Ready!');
  setTimeout(() => loadingScreen.classList.add('hidden'), 300);
}

bootGoogleEarthGlobe()
  .then(() => setMapStyle('photorealistic'))
  .catch((err) => {
    console.error('[GLOBE] Startup failed:', err);
    setProgress(100, 'Ready (limited 3D)');
    loadingScreen.classList.add('hidden');
  });

function setMapStyle(style) {
  const isGridEnabled = document.getElementById('toggleGrid')?.checked;

  if (typeof window.setGlobeMapStyle === 'function') {
    window.setGlobeMapStyle(viewer, style);
  } else {
    imageryLayers.removeAll();
    imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: '/api/tiles/{z}/{x}/{y}.png?lyrs=s',
        credit: 'Google Satellite',
        maximumLevel: 21,
      })
    );
  }
  
  if (isGridEnabled) {
    viewer._gridImagery = imageryLayers.addImageryProvider(new Cesium.GridImageryProvider({
      color: new Cesium.Color(1.0, 1.0, 1.0, 0.15),
      glowWidth: 0
    }));
  }
}

// ─── Search ───
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchClear = document.getElementById('searchClear');
let searchTimeout = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  searchClear.style.display = q ? 'flex' : 'none';
  if (q.length < 2) { searchResults.classList.remove('active'); return; }
  searchTimeout = setTimeout(() => doSearch(q), 350);
});

searchInput.addEventListener('focus', () => {
  if (searchResults.children.length > 0) searchResults.classList.add('active');
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.style.display = 'none';
  searchResults.classList.remove('active');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) searchResults.classList.remove('active');
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  if (e.key === 'Escape') { searchInput.blur(); searchResults.classList.remove('active'); }
});

function getPlaceIcon(type) {
  const m = { city: '🏙️', town: '🏘️', village: '🏡', country: '🌍', state: '📍', hamlet: '🏠',
    peak: '⛰️', mountain: '🏔️', lake: '🌊', river: '🌊', ocean: '🌊', island: '🏝️',
    airport: '✈️', station: '🚉', museum: '🏛️', university: '🎓', hospital: '🏥',
    church: '⛪', mosque: '🕌', temple: '🛕', castle: '🏰', stadium: '🏟️',
    park: '🌳', garden: '🌺', zoo: '🦁', beach: '🏖️', hotel: '🏨', restaurant: '🍽️',
    shop: '🛒', mall: '🛍️', school: '🏫', library: '📚', theatre: '🎭', cinema: '🎬' };
  if (!type) return '📍';
  const tl = type.toLowerCase();
  for (const [k, v] of Object.entries(m)) { if (tl.includes(k)) return v; }
  return '📍';
}

async function doSearch(query) {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    searchResults.innerHTML = '';
    if (!data.length) {
      searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
      searchResults.classList.add('active');
      return;
    }
    data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      const icon = getPlaceIcon(item.type);
      div.innerHTML = `
        <div class="search-result-icon">${icon}</div>
        <div class="search-result-info">
          <div class="search-result-name">${item.display_name.split(',')[0]}</div>
          <div class="search-result-desc">${item.display_name}</div>
        </div>
        <span class="search-result-type">${item.type || 'place'}</span>`;
      div.addEventListener('click', () => flyToResult(item));
      searchResults.appendChild(div);
    });
    searchResults.classList.add('active');
  } catch (e) { console.error('Search error:', e); }
}

function flyToResult(item) {
  searchResults.classList.remove('active');
  const lat = parseFloat(item.lat), lon = parseFloat(item.lon);
  const bb = item.boundingbox;
  let alt = 1500;
  if (bb) {
    const dLat = Math.abs(parseFloat(bb[1]) - parseFloat(bb[0]));
    const dLon = Math.abs(parseFloat(bb[3]) - parseFloat(bb[2]));
    alt = Math.max(dLat, dLon) * 111000 * 1.5;
    alt = Math.max(300, Math.min(alt, 10000000));
  }
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 2.5
  });
}

// ─── Map Style Buttons ───
document.querySelectorAll('.style-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setMapStyle(btn.dataset.style);
  });
});

// ─── Layer Toggles (3D buildings/terrain wired in globe-3d.js when loaded) ───
document.getElementById('toggleBuildings')?.addEventListener('change', (e) => {
  const ts = buildingsTileset || window.getBuildingsTileset?.();
  const p3d = window.getGlobe3DState?.()?.photorealisticTileset;
  if (ts) ts.show = e.target.checked;
  if (p3d) p3d.show = e.target.checked;
  viewer.scene.requestRender();
});
document.getElementById('toggleTerrain')?.addEventListener('change', (e) => {
  const mode = window.getGlobe3DState?.()?.mode;
  const on = e.target.checked;
  if (mode === 'photorealistic') {
    const p3d = window.getGlobe3DState?.()?.photorealisticTileset;
    if (p3d) p3d.show = on;
  } else {
    viewer.scene.globe.show = on;
    viewer.scene.globe.terrainExaggeration = on ? 1.0 : 0.0;
  }
  viewer.scene.requestRender();
});
// 3D Exaggeration slider removed (no UI element)
// const exaggerationSlider = document.getElementById('exaggerationSlider');
// const exaggerationValue = document.getElementById('exaggerationValue');
// if (exaggerationSlider) {
//   exaggerationSlider.addEventListener('input', () => {
//     const factor = parseFloat(exaggerationSlider.value);
//     exaggerationValue.textContent = factor.toFixed(1) + '×';
//     viewer.scene.globe.terrainExaggeration = factor;
//     const p3d = window.getGlobe3DState?.()?.photorealisticTileset;
//     if (p3d) {
//       const scaleMatrix = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(factor, factor, factor));
//       p3d.root.transform = scaleMatrix;
//     }
//     const bTileset = window.getBuildingsTileset?.();
//     if (bTileset) {
//       const scaleMatrix = Cesium.Matrix4.fromScale(new Cesium.Cartesian3(factor, factor, factor));
//       bTileset.root.transform = scaleMatrix;
//     }
//     viewer.scene.requestRender();
//   });
// }
document.getElementById('toggleAtmosphere').addEventListener('change', (e) => {
  viewer.scene.skyAtmosphere.show = e.target.checked;
  viewer.scene.globe.showGroundAtmosphere = e.target.checked;
});
document.getElementById('toggleDayNight').addEventListener('change', (e) => {
  viewer.scene.globe.enableLighting = e.target.checked;
});
document.getElementById('toggleGrid').addEventListener('change', (e) => {
  if (e.target.checked) {
    if (!viewer._gridImagery) {
      viewer._gridImagery = imageryLayers.addImageryProvider(new Cesium.GridImageryProvider({
        color: new Cesium.Color(1.0, 1.0, 1.0, 0.15),
        glowWidth: 0
      }));
    }
  } else if (viewer._gridImagery) {
    imageryLayers.remove(viewer._gridImagery);
    viewer._gridImagery = null;
  }
});
// ─── Restricted Airspaces (Tactical Zones) ───
const airspaceDataSource = new Cesium.CustomDataSource('airspaces');
airspaceDataSource.show = false;
viewer.dataSources.add(airspaceDataSource);

async function loadStrategicAirspaces() {
  try {
    const res = await fetch('/api/airspace');
    const data = await res.json();
    
    data.zones.forEach(z => {
      const color = Cesium.Color.fromCssColorString(z.color);
      
      if (z.polygon) {
        // Convert [[lat, lon], ...] to Cartesian3 array
        const degreesArray = z.polygon.flatMap(p => [p[1], p[0]]); // lon, lat
        airspaceDataSource.entities.add({
          id: z.id,
          name: z.name,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
            material: color.withAlpha(0.15),
            outline: true,
            outlineColor: color.withAlpha(0.8),
            outlineWidth: 2,
            height: 0
            // Removed extrudedHeight to prevent computeWallGeometry crash on complex FIR boundaries
          },
          properties: {
            isAirspace: true,
            description: `Zone Type: ${z.type}`,
            country: 'India',
            radius: 'N/A'
          }
        });
      } else if (z.polyline) {
        const degreesArray = z.polyline.flatMap(p => [p[1], p[0]]); // lon, lat
        airspaceDataSource.entities.add({
          id: z.id,
          name: z.name,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(degreesArray),
            width: 4,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.2,
              color: color
            })
          },
          properties: {
            isAirspace: true,
            description: `Border/Line: ${z.type}`,
            country: 'India',
            radius: 'N/A'
          }
        });
      } else if (z.center && z.radius_km) {
        airspaceDataSource.entities.add({
          id: z.id,
          name: z.name,
          position: Cesium.Cartesian3.fromDegrees(z.center[1], z.center[0], 0), // lon, lat
          ellipse: {
            semiMinorAxis: z.radius_km * 1000,
            semiMajorAxis: z.radius_km * 1000,
            material: color.withAlpha(0.2),
            outline: true,
            outlineColor: color,
            outlineWidth: 2,
            height: 0,
            extrudedHeight: 15000
          },
          properties: {
            isAirspace: true,
            description: `Zone Type: ${z.type}`,
            country: 'India',
            radius: z.radius_km * 1000
          }
        });
      }
    });
  } catch (err) {
    console.error('Failed to load airspaces:', err);
  }
}

loadStrategicAirspaces();

// ─── Global FIR Boundaries (Whole World) ───
window.globalFirDataSource = null;

Cesium.GeoJsonDataSource.load('https://gist.githubusercontent.com/LC43/5d6a009d83172d308a01a1c864b71e68/raw', {
  stroke: Cesium.Color.CYAN.withAlpha(0.8),
  fill: Cesium.Color.TRANSPARENT,
  strokeWidth: 2
}).then((dataSource) => {
  window.globalFirDataSource = dataSource;
  dataSource.name = "Global FIRs";
  
  // Sync initial state
  const isChecked = document.getElementById('toggleAirspaces') ? document.getElementById('toggleAirspaces').checked : false;
  dataSource.show = isChecked;
  viewer.dataSources.add(dataSource);

  // Tactical colors used in Indian FIRs (Delhi, Mumbai, Chennai, Kolkata)
  const tacticalColors = [
    Cesium.Color.fromCssColorString('#00FF41'), // Green
    Cesium.Color.fromCssColorString('#00D4FF'), // Cyan
    Cesium.Color.fromCssColorString('#FFB300'), // Amber
    Cesium.Color.fromCssColorString('#CC44FF')  // Purple
  ];

  const entities = dataSource.entities.values;
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const color = tacticalColors[i % tacticalColors.length];
    
    // Set custom tactical properties for tooltip
    entity.properties.isAirspace = true;
    entity.properties.description = `Global Flight Information Region (FIR)\nICAO: ${entity.properties.ICAO?.getValue() || 'N/A'}`;
    entity.name = entity.properties.name?.getValue() || 'FIR BOUNDARY';

    if (entity.polygon) {
      // DESTROY polygon geometry completely. It's too complex and crashes Cesium at the dateline.
      // We will handle picking purely mathematically using raw JS.
      const hierarchy = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now());
      if (hierarchy && hierarchy.positions) {
        entity.polyline = new Cesium.PolylineGraphics({
          positions: hierarchy.positions,
          width: 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15,
            color: color
          })
        });
      }
      entity.polygon = undefined; 
    }
  }

  // Pre-fetch raw GeoJSON for mathematical point-in-polygon picking (zero WebGL crashes)
  fetch('https://gist.githubusercontent.com/LC43/5d6a009d83172d308a01a1c864b71e68/raw')
    .then(r => r.json())
    .then(data => { window.rawGlobalFirs = data; });

  console.log('Global FIRs loaded successfully.');
  console.log('Global FIRs loaded successfully.');
}).catch(err => console.error("Global FIRs failed to load:", err));

// ─── Normal Airspaces Overlay (Global) ───
const airspacesProvider = new Cesium.UrlTemplateImageryProvider({
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Specialty/World_Navigation_Charts/MapServer/tile/{z}/{y}/{x}',
  credit: 'Esri Navigation Charts',
  maximumLevel: 10
});
const airspacesLayer = viewer.imageryLayers.addImageryProvider(airspacesProvider);
airspacesLayer.show = false;
airspacesLayer.alpha = 0.45; // Semi-transparent so satellite shows through

document.getElementById('toggleAirspaces').addEventListener('change', (e) => {
  airspaceDataSource.show = e.target.checked;
  airspacesLayer.show = e.target.checked;
  if (window.globalFirDataSource) {
    window.globalFirDataSource.show = e.target.checked;
  }
  viewer.scene.requestRender();
});

// ─── Side Panel Toggle ───
const sidePanel = document.getElementById('sidePanel');
document.getElementById('panelToggle').addEventListener('click', () => {
  sidePanel.classList.toggle('collapsed');
});

// ─── Quick Fly-To ───
document.querySelectorAll('.flyto-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const lat = parseFloat(btn.dataset.lat);
    const lon = parseFloat(btn.dataset.lon);
    const alt = parseFloat(btn.dataset.alt);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation: { heading: Cesium.Math.toRadians(10), pitch: Cesium.Math.toRadians(-35), roll: 0 },
      duration: 3
    });
  });
});

// ─── Bottom Controls ───
document.getElementById('btnZoomIn').addEventListener('click', () => {
  viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.4);
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
  viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.6);
});
document.getElementById('btnHome').addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 8000000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 2
  });
});
document.getElementById('btnNorth').addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: viewer.camera.position,
    orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
    duration: 1
  });
});
document.getElementById('btnTopDown').addEventListener('click', () => {
  viewer.camera.flyTo({
    destination: viewer.camera.position,
    orientation: { heading: viewer.camera.heading, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1
  });
});
document.getElementById('btnFullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
});

// ─── Mouse coordinate tracking & Hover Tooltips ───
const coordLat = document.getElementById('coordLat');
const coordLon = document.getElementById('coordLon');
const coordAlt = document.getElementById('coordAlt');

const hoverTooltip = document.createElement('div');
hoverTooltip.style.position = 'absolute';
hoverTooltip.style.background = 'rgba(15, 23, 42, 0.9)';
hoverTooltip.style.color = '#f87171';
hoverTooltip.style.padding = '10px 14px';
hoverTooltip.style.borderRadius = '6px';
hoverTooltip.style.pointerEvents = 'none';
hoverTooltip.style.fontSize = '13px';
hoverTooltip.style.border = '1px solid #ef4444';
hoverTooltip.style.zIndex = '9999';
hoverTooltip.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.5)';
hoverTooltip.style.display = 'none';
document.body.appendChild(hoverTooltip);

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((movement) => {
  // 1. Update Coordinates
  const cart = viewer.camera.pickEllipsoid(movement.endPosition, viewer.scene.globe.ellipsoid);
  if (cart) {
    const carto = Cesium.Cartographic.fromCartesian(cart);
    coordLat.textContent = Cesium.Math.toDegrees(carto.latitude).toFixed(4) + '°';
    coordLon.textContent = Cesium.Math.toDegrees(carto.longitude).toFixed(4) + '°';
  }

  // 2. Hover Tooltip
  const picked = viewer.scene.pick(movement.endPosition, 10, 10);
  
  const hoverSatId = window.getSatIdFromPick?.(picked);
  if (hoverSatId && window.satTrackerData) {
    const s = window.satTrackerData[hoverSatId];
    if (s) {
      const satColors = { MILITARY: '#ef4444', TELECOM: '#3b82f6', WEATHER: '#10b981', SCIENTIFIC: '#a855f7', SPACE_STATION: '#fcd34d', COMMERCIAL: '#38bdf8' };
      const satIcons = { MILITARY: '⚔️', TELECOM: '📡', WEATHER: '🌤️', SCIENTIFIC: '🔬', SPACE_STATION: '🛰️', COMMERCIAL: '💎' };
      const sc = satColors[s.type] || '#fbbf24';
      const si = satIcons[s.type] || '🛰️';
      hoverTooltip.innerHTML = `
        <b style="font-size: 14px; color: ${sc};">${si} ${s.name}</b><br>
        <div style="margin-top: 4px; color: #cbd5e1;">NORAD: #${s.norad_id} | Alt: ${s.alt_km} km</div>
        <div style="margin-top: 6px; font-weight: 600; color: ${sc};">${s.type.replace('_', ' ')}</div>
      `;
      hoverTooltip.style.left = (movement.endPosition.x + 15) + 'px';
      hoverTooltip.style.top = (movement.endPosition.y + 15) + 'px';
      hoverTooltip.style.display = 'block';
      return;
    }
  }

  const hoverVesselId = window.getVesselIdFromPick?.(picked);
  if (hoverVesselId) {
    const v = window.getVesselById?.(hoverVesselId);
    if (v) {
      const mil = !!v.isMilitary;
      const color = mil ? '#f87171' : '#38bdf8';
      const label = mil ? '⚔ MILITARY VESSEL' : '🚢 COMMERCIAL VESSEL';
      hoverTooltip.innerHTML = `
        <b style="font-size: 14px; color: ${color};">🚢 ${v.name}</b><br>
        <div style="margin-top: 4px; color: #cbd5e1;">${v.lat.toFixed(4)}°, ${v.lon.toFixed(4)}° · ${(v.sog || 0).toFixed(1)} kn</div>
        <div style="margin-top: 6px; font-weight: 600; color: ${color};">${label}</div>
      `;
      hoverTooltip.style.left = (movement.endPosition.x + 15) + 'px';
      hoverTooltip.style.top = (movement.endPosition.y + 15) + 'px';
      hoverTooltip.style.display = 'block';
      return;
    }
  }

  if (Cesium.defined(picked) && picked.primitive && picked.primitive.flightId) {
    const f = flightsById[picked.primitive.flightId];
    if (f) {
      const typeLabel = f.isMilitary ? "⚔️ TACTICAL MILITARY TARGET" : "✈️ COMMERCIAL FLIGHT";
      const color = f.isMilitary ? "#f87171" : "#4ade80";
      hoverTooltip.innerHTML = `
        <b style="font-size: 14px; color: ${color};">${f.isMilitary ? '⚔️' : '✈️'} ${f.callsign}</b><br>
        <div style="margin-top: 4px; color: #cbd5e1;">Alt: ${Math.round(f.alt)}m | Spd: ${Math.round(f.velocity * 3.6)} km/h</div>
        <div style="margin-top: 6px; font-weight: 600; color: ${color};">${typeLabel}</div>
      `;
      hoverTooltip.style.left = (movement.endPosition.x + 15) + 'px';
      hoverTooltip.style.top = (movement.endPosition.y + 15) + 'px';
      hoverTooltip.style.display = 'block';
      return;
    }
  }

  if (Cesium.defined(picked) && picked.id && picked.id.properties && picked.id.properties.isAirspace) {
    let typeLabel = "RESTRICTED AIRSPACE";
    if (picked.id.properties.description.getValue().includes('FIR')) {
      typeLabel = "STRATEGIC AIRSPACE ZONE";
    }

    hoverTooltip.innerHTML = `
      <b style="font-size: 14px; color: #fff;">🛑 ${picked.id.name}</b><br>
      <div style="margin-top: 4px; color: #cbd5e1;">${picked.id.properties.description.getValue()}</div>
      <div style="margin-top: 6px; font-weight: 600; color: #ef4444;">${typeLabel}</div>
    `;
    hoverTooltip.style.left = (movement.endPosition.x + 15) + 'px';
    hoverTooltip.style.top = (movement.endPosition.y + 15) + 'px';
    hoverTooltip.style.display = 'block';
  } else if (window.rawGlobalFirs && window.globalFirDataSource && window.globalFirDataSource.show) {
    // Math-based picking for Global FIRs to avoid WebGL polygons
    if (cart) {
      const carto = Cesium.Cartographic.fromCartesian(cart);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      
      let foundFeature = null;
      for (let f of window.rawGlobalFirs.features) {
        const p = f.properties;
        if (lat >= parseFloat(p.MinLat) && lat <= parseFloat(p.MaxLat) &&
            lon >= parseFloat(p.MinLon) && lon <= parseFloat(p.MaxLon)) {
            
            // Check Point in Polygon
            let inside = false;
            const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
            for (let poly of polys) {
              const ring = poly[0]; // outer ring
              for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                let xi = ring[i][0], yi = ring[i][1];
                let xj = ring[j][0], yj = ring[j][1];
                let intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
              }
            }
            if (inside) {
              foundFeature = f;
              break;
            }
        }
      }

      if (foundFeature) {
        hoverTooltip.innerHTML = `
          <b style="font-size: 14px; color: #fff;">🛑 ${foundFeature.properties.name || 'FIR BOUNDARY'}</b><br>
          <div style="margin-top: 4px; color: #cbd5e1;">Global Flight Information Region (FIR)<br>ICAO: ${foundFeature.properties.ICAO || 'N/A'}</div>
          <div style="margin-top: 6px; font-weight: 600; color: #ef4444;">STRATEGIC AIRSPACE ZONE</div>
        `;
        hoverTooltip.style.left = (movement.endPosition.x + 15) + 'px';
        hoverTooltip.style.top = (movement.endPosition.y + 15) + 'px';
        hoverTooltip.style.display = 'block';
      } else {
        hoverTooltip.style.display = 'none';
      }
    } else {
      hoverTooltip.style.display = 'none';
    }
  } else {
    hoverTooltip.style.display = 'none';
  }
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

// ─── Flight Picking (Single Click) ───
handler.setInputAction((click) => {
  const picked = viewer.scene.pick(click.position, 10, 10);
  const clickVesselId = window.getVesselIdFromPick?.(picked);
  if (clickVesselId && window.selectVessel) {
    window.clearSatelliteSelection?.();
    window.clearFlightSelection?.();
    locationPopup.classList.add('hidden');
    window.selectVessel(clickVesselId);
    return;
  }

  const clickFlightId = picked?.primitive?.flightId;
  if (clickFlightId && window.selectFlight) {
    window.clearSatelliteSelection?.();
    window.clearVesselSelection?.();
    locationPopup.classList.add('hidden');
    window.selectFlight(clickFlightId);
    return;
  } else {
    const clickSatId = window.getSatIdFromPick?.(picked);
    if (clickSatId && window.selectSatellite) {
      locationPopup.classList.add('hidden');
      window.clearFlightSelection?.();
      window.clearVesselSelection?.();
      window.selectSatellite(clickSatId);
      return;
    }
    window.clearSatelliteSelection?.();
    window.clearFlightSelection?.();
    window.clearVesselSelection?.();
  }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// ─── Click for reverse geocode ───
const locationPopup = document.getElementById('locationPopup');
handler.setInputAction(async (click) => {
  window.clearSatelliteSelection?.();
  window.clearFlightSelection?.();
  const cart = viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid);
  if (!cart) return;
  const carto = Cesium.Cartographic.fromCartesian(cart);
  const lat = Cesium.Math.toDegrees(carto.latitude);
  const lon = Cesium.Math.toDegrees(carto.longitude);

  document.getElementById('popupTitle').textContent = 'Loading...';
  document.getElementById('popupCoords').textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  document.getElementById('popupType').textContent = '—';
  document.getElementById('popupAddress').textContent = '—';
  locationPopup.classList.remove('hidden');

  try {
    const res = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    document.getElementById('popupTitle').textContent = data.display_name?.split(',')[0] || 'Unknown';
    document.getElementById('popupType').textContent = data.type || data.addresstype || '—';
    document.getElementById('popupAddress').textContent = data.display_name || '—';

    document.getElementById('popupFlyTo').onclick = () => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, 500),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 2
      });
    };
  } catch (e) { console.error(e); }
}, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

document.getElementById('popupClose').addEventListener('click', () => {
  locationPopup.classList.add('hidden');
});

// ─── Camera Info Update ───
const camLat = document.getElementById('camLat');
const camLon = document.getElementById('camLon');
const camAlt = document.getElementById('camAlt');
const camHeading = document.getElementById('camHeading');
const camPitch = document.getElementById('camPitch');

viewer.camera.changed.addEventListener(() => updateCameraInfo());
viewer.camera.moveEnd.addEventListener(() => updateCameraInfo());

function updateCameraInfo() {
  const pos = viewer.camera.positionCartographic;
  camLat.textContent = Cesium.Math.toDegrees(pos.latitude).toFixed(4) + '°';
  camLon.textContent = Cesium.Math.toDegrees(pos.longitude).toFixed(4) + '°';
  const h = pos.height;
  camAlt.textContent = h > 1000 ? (h / 1000).toFixed(1) + ' km' : h.toFixed(0) + ' m';
  coordAlt.textContent = camAlt.textContent;
  camHeading.textContent = Cesium.Math.toDegrees(viewer.camera.heading).toFixed(1) + '°';
  camPitch.textContent = Cesium.Math.toDegrees(viewer.camera.pitch).toFixed(1) + '°';
}
updateCameraInfo();



// ─── LIVE GLOBAL FLIGHTS (BILLBOARD AIRCRAFT ICONS) ───
const FLIGHT_POLL_MS = 1500;

/** Cesium billboards need raster images — build a white plane PNG for color tinting */
function buildPlaneIconDataUrl() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(32, 4);
  ctx.lineTo(28, 24);
  ctx.lineTo(12, 28);
  ctx.lineTo(12, 32);
  ctx.lineTo(26, 30);
  ctx.lineTo(26, 44);
  ctx.lineTo(20, 48);
  ctx.lineTo(20, 52);
  ctx.lineTo(32, 50);
  ctx.lineTo(44, 52);
  ctx.lineTo(44, 48);
  ctx.lineTo(38, 44);
  ctx.lineTo(38, 30);
  ctx.lineTo(52, 32);
  ctx.lineTo(52, 28);
  ctx.lineTo(36, 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return canvas.toDataURL('image/png');
}

const PLANE_ICON = buildPlaneIconDataUrl();
const FLIGHT_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(2e4, 1.4, 1.2e7, 0.55);

const flightBillboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
flightBillboards.show = false;

let flightInterval = null;
let flightFetchBusy = false;
const flightsById = {};
const flightMarkers = {};
const flightHistory = {};
let selectedFlightId = null;
let selectedFlightPathEntity = null;
let highlightedFlightMarker = null;
let highlightedFlightScale = null;

function setFlightRenderMode(enabled) {
  viewer.targetFrameRate = 60;
  viewer.useDefaultRenderLoop = true;
  viewer.scene.requestRender();
}

function trackToBillboardRotation(trackDeg) {
  return -Cesium.Math.toRadians(trackDeg || 0);
}

function flightBillboardOptions(f, position) {
  const isMil = !!f.isMilitary;
  return {
    image: PLANE_ICON,
    position,
    width: isMil ? 32 : 26,
    height: isMil ? 32 : 26,
    scale: isMil ? 1.1 : 1.0,
    rotation: trackToBillboardRotation(f.track),
    color: Cesium.Color.fromCssColorString(isMil ? '#f87171' : '#4ade80'),
    scaleByDistance: FLIGHT_SCALE_BY_DISTANCE,
    verticalOrigin: Cesium.VerticalOrigin.CENTER,
    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
    show: true
  };
}

const flightPopup = document.getElementById('flightPopup');
const flightPopupTitle = document.getElementById('flightPopupTitle');
const flightPopupBadge = document.getElementById('flightPopupBadge');
const flightPopupDetails = document.getElementById('flightPopupDetails');
const flightPopupFlyTo = document.getElementById('flightPopupFlyTo');

function recordFlightPosition(f) {
  if (f.lat == null || f.lon == null) return;
  if (!flightHistory[f.id]) flightHistory[f.id] = [];
  const hist = flightHistory[f.id];
  const last = hist[hist.length - 1];
  if (!last || Math.hypot(f.lat - last.lat, f.lon - last.lon) > 0.02) {
    hist.push({ lat: f.lat, lon: f.lon, alt: f.alt });
    if (hist.length > 60) hist.shift();
  }
}

function computeFlightPath(f) {
  const positions = [];
  const history = flightHistory[f.id] || [];
  history.forEach((p) => {
    positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt || f.alt || 10000));
  });
  if (!positions.length) {
    positions.push(Cesium.Cartesian3.fromDegrees(f.lon, f.lat, f.alt || 10000));
  }

  let lat = f.lat;
  let lon = f.lon;
  const altM = f.alt || 10000;
  const trackRad = Cesium.Math.toRadians(f.track || 0);
  const speedMs = f.velocity || 200;
  const stepSec = 30;
  const steps = f.isMilitary ? 100 : 50;

  for (let i = 1; i <= steps; i++) {
    const distM = speedMs * stepSec;
    const dLat = (distM * Math.cos(trackRad)) / 111320;
    const dLon = (distM * Math.sin(trackRad)) / (111320 * Math.cos(Cesium.Math.toRadians(lat)));
    lat += dLat;
    lon += dLon;
    positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, altM));
  }
  return positions;
}

function renderFlightPanel(f) {
  const isMil = !!f.isMilitary;
  const color = isMil ? '#f87171' : '#4ade80';
  const speedKmh = Math.round((f.velocity || 0) * 3.6);
  const speedKts = Math.round((f.velocity || 0) * 1.94384);
  const altFt = Math.round((f.alt || 0) * 3.28084);

  flightPopup.classList.toggle('military', isMil);
  flightPopupTitle.textContent = isMil ? `⚔️ ${f.callsign}` : `✈️ ${f.callsign}`;
  flightPopupBadge.textContent = isMil ? 'Military (adsb.lol)' : 'Civilian ADS-B';
  flightPopupBadge.style.color = color;
  flightPopupBadge.style.borderColor = color + '55';
  flightPopupBadge.style.background = color + '22';
  flightPopupTitle.style.color = color;

  const rows = [
    ['Flight ID', f.id || '—'],
    ['Callsign', f.callsign || '—'],
    ['Data Source', f.source || '—'],
    ['Latitude', f.lat != null ? `${f.lat.toFixed(4)}°` : '—'],
    ['Longitude', f.lon != null ? `${f.lon.toFixed(4)}°` : '—'],
    ['Altitude', f.alt != null ? `${Math.round(f.alt)} m (${altFt} ft)` : '—'],
    ['Ground Speed', `${speedKmh} km/h (${speedKts} kts)`],
    ['Track / Heading', f.track != null ? `${Math.round(f.track)}°` : '—'],
    ['Country / Route', f.country || '—'],
  ];

  if (f.registration) rows.push(['Registration', f.registration]);
  if (f.squawk) rows.push(['Squawk', f.squawk]);
  if (f.category) rows.push(['Category', f.category]);

  if (isMil) {
    rows.push(['Aircraft Type', f.type || '—']);
    rows.push(['Classification', 'MILITARY / ADSB.LOL']);
  }

  flightPopupDetails.innerHTML = rows.map(([label, value]) => `
    <div class="popup-row"><span>${label}</span><span>${value}</span></div>
  `).join('');

  flightPopupFlyTo.onclick = () => {
    if (f.lon == null || f.lat == null) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(f.lon, f.lat, (f.alt || 10000) + 8000),
      orientation: {
        heading: Cesium.Math.toRadians(f.track || 0),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0
      },
      duration: 2
    });
  };

  flightPopup.classList.remove('hidden');
}

function clearFlightSelection() {
  if (selectedFlightPathEntity) {
    viewer.entities.remove(selectedFlightPathEntity);
    selectedFlightPathEntity = null;
  }
  if (highlightedFlightMarker && highlightedFlightScale != null) {
    highlightedFlightMarker.scale = highlightedFlightScale;
    highlightedFlightMarker = null;
    highlightedFlightScale = null;
  }
  selectedFlightId = null;
  if (flightPopup) flightPopup.classList.add('hidden');
  viewer.scene.requestRender();
}

function selectFlight(flightId) {
  const f = flightsById[flightId];
  if (!f) return;

  clearFlightSelection();
  selectedFlightId = flightId;

  const pathColor = f.isMilitary ? '#f87171' : '#4ade80';
  const pathPositions = computeFlightPath(f);

  if (pathPositions.length > 1) {
    selectedFlightPathEntity = viewer.entities.add({
      polyline: {
        positions: pathPositions,
        width: 2.5,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.15,
          color: Cesium.Color.fromCssColorString(pathColor).withAlpha(0.9)
        }),
        arcType: Cesium.ArcType.GEODESIC
      }
    });

    const sphere = Cesium.BoundingSphere.fromPoints(pathPositions);
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 2,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(f.track || 0),
        Cesium.Math.toRadians(-40),
        Math.max(sphere.radius * 2.5, 50000)
      )
    });
  }

  if (flightMarkers[flightId]) {
    highlightedFlightMarker = flightMarkers[flightId];
    highlightedFlightScale = highlightedFlightMarker.scale;
    highlightedFlightMarker.scale = (highlightedFlightScale || 1) * 1.6;
  }

  renderFlightPanel(f);
  viewer.scene.requestRender();
}

window.selectFlight = selectFlight;
window.clearFlightSelection = clearFlightSelection;
window.getFlightIdFromPick = (picked) => picked?.primitive?.flightId || null;

document.getElementById('flightPopupClose')?.addEventListener('click', clearFlightSelection);

async function fetchAndRenderFlights() {
  if (!document.getElementById('toggleFlights').checked || flightFetchBusy) return;
  flightFetchBusy = true;
  try {
    const source = document.getElementById('flightSource')?.value || 'auto';
    const res = await fetch(`/api/flights?source=${source}&_=${Date.now()}`);
    const data = await res.json();
    if (!data.flights) return;

    const statusEl = document.getElementById('flightFeedStatus');
    if (statusEl) {
      statusEl.textContent = data.error
        ? '⚠ feed error'
        : `${data.count} · ${data.civilian || 0}c/${data.military || 0}m`;
    }

    const currentIds = new Set();

    data.flights.forEach(f => {
      if (f.lat == null || f.lon == null) return;
      currentIds.add(f.id);
      flightsById[f.id] = f;
      recordFlightPosition(f);
      if (f.id === selectedFlightId) renderFlightPanel(f);

      const position = Cesium.Cartesian3.fromDegrees(f.lon, f.lat, Math.max(f.alt || 0, 100));
      const opts = flightBillboardOptions(f, position);

      if (flightMarkers[f.id]) {
        const b = flightMarkers[f.id];
        b.show = true;
        b.position = position;
        b.rotation = opts.rotation;
        b.color = opts.color;
        if (f.id !== selectedFlightId) b.scale = opts.scale;
      } else {
        const billboard = flightBillboards.add(opts);
        billboard.flightId = f.id;
        flightMarkers[f.id] = billboard;
      }
    });

    Object.keys(flightMarkers).forEach(id => {
      if (!currentIds.has(id)) {
        flightBillboards.remove(flightMarkers[id]);
        delete flightMarkers[id];
        delete flightsById[id];
        delete flightHistory[id];
        if (id === selectedFlightId) clearFlightSelection();
      }
    });

    if (selectedFlightId && flightsById[selectedFlightId]) {
      const sel = flightsById[selectedFlightId];
      if (selectedFlightPathEntity) {
        viewer.entities.remove(selectedFlightPathEntity);
      }
      const pathPositions = computeFlightPath(sel);
      if (pathPositions.length > 1) {
        const pathColor = sel.isMilitary ? '#f87171' : '#4ade80';
        selectedFlightPathEntity = viewer.entities.add({
          polyline: {
            positions: pathPositions,
            width: 2.5,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.15,
              color: Cesium.Color.fromCssColorString(pathColor).withAlpha(0.9)
            }),
            arcType: Cesium.ArcType.GEODESIC
          }
        });
      }
    }
    
    if (!viewer.scene.requestRenderMode) {
      // continuous 60fps loop — no-op
    } else {
      viewer.scene.requestRender();
    }
  } catch (err) {
    console.error('Failed to update flights:', err);
  } finally {
    flightFetchBusy = false;
  }
}

document.getElementById('toggleFlights').addEventListener('change', (e) => {
  const on = e.target.checked;
  flightBillboards.show = on;
  setFlightRenderMode(on);
  const sourceContainer = document.getElementById('flightSourceContainer');
  if (sourceContainer) {
    sourceContainer.style.display = on ? 'flex' : 'none';
  }

  if (on) {
    fetchAndRenderFlights();
    flightInterval = setInterval(fetchAndRenderFlights, FLIGHT_POLL_MS);
  } else {
    clearInterval(flightInterval);
    clearFlightSelection();
    Object.keys(flightMarkers).forEach((id) => {
      flightBillboards.remove(flightMarkers[id]);
      delete flightMarkers[id];
    });
  }
  viewer.scene.requestRender();
});

document.getElementById('flightSource')?.addEventListener('change', () => {
  fetchAndRenderFlights();
});

// ─── SATELLITE TRACKING & XYZ GRID ───
// Handled by satellite-tracker.js module (loaded after app.js)

console.log('🌍 Earth 3D Globe initialized successfully');
