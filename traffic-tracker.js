/**
 * Live Street Traffic Tracker & Management System — OpenStreetMap & CesiumJS
 */
(function () {
  'use strict';

  let viewer = null;
  let trafficDataSource = null;
  let vehicleDataSource = null;
  let isEnabled = false;
  let updateTimer = null;
  let clockListener = null;
  let cameraListener = null;

  // Active state parameters
  const state = {
    roads: [], // { id, name, points, congestion, speedKm, lengthDeg, vehicles: [] }
    selectedRoadId: null,
    optimizingSignals: false,
    signalTimer: null,
    patrolActive: false,
    patrolEntity: null,
    patrolRoadId: null,
    patrolProgress: 0,
    reroutingActive: false,
    detourEntity: null,
    reroutedRoadId: null,
    gridlockActive: false,
    gridlockTimer: null,
    lastBbox: null
  };

  // Helper for computing distance along segments
  function getPathLength(points) {
    let d = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i+1];
      d += Math.hypot(p2.lat - p1.lat, p2.lon - p1.lon);
    }
    return d || 0.001;
  }

  // Interpolation along a multi-segment line
  function interpolatePosition(points, progress) {
    if (!points || points.length === 0) return null;
    if (points.length === 1) return points[0];

    const numSegments = points.length - 1;
    const rawIndex = progress * numSegments;
    const segmentIndex = Math.min(Math.floor(rawIndex), numSegments - 1);
    const segmentProgress = rawIndex - segmentIndex;

    const p1 = points[segmentIndex];
    const p2 = points[segmentIndex + 1];

    const lat = p1.lat + (p2.lat - p1.lat) * segmentProgress;
    const lon = p1.lon + (p2.lon - p1.lon) * segmentProgress;

    return { lat, lon };
  }

  // Get current camera altitude in meters
  function getCameraAltitude() {
    if (!viewer) return 100000;
    const height = viewer.camera.positionCartographic.height;
    return height;
  }

  // Find camera viewport bounding box
  function getViewportBounds() {
    if (!viewer) return null;
    const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rect) return null;

    return {
      west: Cesium.Math.toDegrees(rect.west),
      south: Cesium.Math.toDegrees(rect.south),
      east: Cesium.Math.toDegrees(rect.east),
      north: Cesium.Math.toDegrees(rect.north)
    };
  }

  function ensureLayers() {
    if (!viewer && window.viewer) {
      viewer = window.viewer;
      trafficDataSource = new Cesium.CustomDataSource('street-traffic');
      vehicleDataSource = new Cesium.CustomDataSource('traffic-vehicles');
      viewer.dataSources.add(trafficDataSource);
      viewer.dataSources.add(vehicleDataSource);
    }
    return viewer;
  }

  // Generate gorgeous simulated road grid centered on view coordinates (fallback/offline)
  function generateProceduralTraffic(lat, lon, bounds) {
    const roads = [];
    const sizeDeg = Math.min(0.02, Math.abs(bounds.north - bounds.south) * 0.6);
    const numRoads = 8;
    const roadPrefixes = [
      "Vikas Marg", "Ring Road Link", "Sardar Patel Avenue", "Shanti Path Bypass",
      "Central Vista Expressway", "Cyber City Boulevard", "Mall Road", "Station Avenue",
      "Eiffel Bypass", "Giza Gateway", "Broadway Link", "Metro Trunk Road"
    ];

    for (let i = 0; i < numRoads; i++) {
      const isVertical = i % 2 === 0;
      // Spread roads around center
      const offset = (i - numRoads/2) * (sizeDeg / (numRoads/2)) + (Math.random() - 0.5) * 0.0015;
      const points = [];

      if (isVertical) {
        const rLon = lon + offset;
        const startLat = lat - sizeDeg/2 + (Math.random() - 0.5) * 0.002;
        const endLat = lat + sizeDeg/2 + (Math.random() - 0.5) * 0.002;

        for (let j = 0; j <= 5; j++) {
          const frac = j / 5;
          const pLat = startLat + frac * (endLat - startLat);
          const pLon = rLon + Math.sin(frac * Math.PI) * 0.0003; // curly/realistic bend
          points.push({ lat: pLat, lon: pLon });
        }
      } else {
        const rLat = lat + offset;
        const startLon = lon - sizeDeg/2 + (Math.random() - 0.5) * 0.002;
        const endLon = lon + sizeDeg/2 + (Math.random() - 0.5) * 0.002;

        for (let j = 0; j <= 5; j++) {
          const frac = j / 5;
          const pLon = startLon + frac * (endLon - startLon);
          const pLat = rLat + Math.sin(frac * Math.PI) * 0.0003; // curly/realistic bend
          points.push({ lat: pLat, lon: pLon });
        }
      }

      // Assign initial congestion status
      const roll = Math.random();
      let congestion = "smooth";
      if (roll > 0.75) congestion = "congested";
      else if (roll > 0.5) congestion = "moderate";

      const name = roadPrefixes[Math.floor(Math.random() * roadPrefixes.length)] + " Sector-" + (i + 1);
      const roadId = `proc-road-${i}-${Date.now().toString(36)}`;
      const lengthDeg = getPathLength(points);

      // Spawn vehicles
      const vehicles = [];
      const numVehicles = 3 + Math.floor(Math.random() * 4);
      for (let v = 0; v < numVehicles; v++) {
        vehicles.push({
          progress: v / numVehicles,
          speedOffset: 0.8 + Math.random() * 0.4
        });
      }

      roads.push({
        id: roadId,
        name,
        points,
        congestion,
        lengthDeg,
        vehicles
      });
    }

    return roads;
  }

  // Parse Overpass API JSON format into roads
  function parseOverpassData(data) {
    const roads = [];
    if (!data.elements) return roads;

    const elements = data.elements.filter(e => e.type === "way" && e.geometry);
    
    elements.forEach((e, index) => {
      const points = e.geometry.map(g => ({ lat: g.lat, lon: g.lon }));
      if (points.length < 2) return;

      const name = e.tags.name || e.tags.ref || `Unidentified Street (${e.tags.highway || 'road'})`;
      
      const roll = Math.random();
      let congestion = "smooth";
      if (roll > 0.75) congestion = "congested";
      else if (roll > 0.5) congestion = "moderate";

      const lengthDeg = getPathLength(points);
      const vehicles = [];
      const numVehicles = 2 + Math.floor(Math.random() * 4);
      for (let v = 0; v < numVehicles; v++) {
        vehicles.push({
          progress: v / numVehicles,
          speedOffset: 0.85 + Math.random() * 0.3
        });
      }

      roads.push({
        id: `osm-road-${e.id}-${index}`,
        name,
        points,
        congestion,
        lengthDeg,
        vehicles
      });
    });

    return roads;
  }

  // Fetch from Overpass API with local fallback
  async function fetchTrafficData() {
    ensureLayers();
    if (!isEnabled || !viewer) return;

    const alt = getCameraAltitude();
    if (alt > 15000) {
      // Too high
      state.roads = [];
      clearMapEntities();
      updatePanelUi(true); // show zoom-in warning
      return;
    }

    const bounds = getViewportBounds();
    if (!bounds) return;

    // Throttle fetches if camera has barely moved
    if (state.lastBbox) {
      const dcLat = Math.abs((bounds.north + bounds.south)/2 - (state.lastBbox.north + state.lastBbox.south)/2);
      const dcLon = Math.abs((bounds.east + bounds.west)/2 - (state.lastBbox.east + state.lastBbox.west)/2);
      if (dcLat < 0.0015 && dcLon < 0.0015 && state.roads.length > 0) {
        return; // camera stationary, skip refresh
      }
    }
    state.lastBbox = bounds;

    const lat = (bounds.north + bounds.south) / 2;
    const lon = (bounds.east + bounds.west) / 2;

    try {
      // Query motorway, trunk, primary, secondary roads in bbox
      const query = `[out:json][timeout:3];way["highway"~"motorway|trunk|primary|secondary|tertiary"](${bounds.south.toFixed(4)},${bounds.west.toFixed(4)},${bounds.north.toFixed(4)},${bounds.east.toFixed(4)});out geom 45;`;
      const url = `/api/overpass?q=${encodeURIComponent(query)}`;
      
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000); // 4s timeout for snappy UI
      
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      
      if (!res.ok) throw new Error("Overpass HTTP " + res.status);
      const data = await res.json();
      const loadedRoads = parseOverpassData(data);
      
      if (loadedRoads.length > 0) {
        state.roads = loadedRoads;
        console.log(`[TRAFFIC] Loaded ${loadedRoads.length} roads from OpenStreetMap.`);
      } else {
        // Bounding box empty of OSM highways, use fallback grid
        state.roads = generateProceduralTraffic(lat, lon, bounds);
        console.log("[TRAFFIC] Bounding box empty. Generated procedural grid.");
      }
    } catch (err) {
      console.warn("[TRAFFIC] Overpass API failed or timed out. Initiating procedural simulation fallback:", err.message);
      state.roads = generateProceduralTraffic(lat, lon, bounds);
    }

    // Keep active rerouting/patrol active on reload if their road still exists
    if (state.patrolActive && !state.roads.some(r => r.id === state.patrolRoadId)) {
      clearPatrol();
    }
    if (state.reroutingActive && !state.roads.some(r => r.id === state.reroutedRoadId)) {
      clearReroute();
    }

    renderRoadsOnMap();
    updatePanelUi(false);
  }

  // Clear map layers
  function clearMapEntities() {
    if (trafficDataSource) trafficDataSource.entities.removeAll();
    if (vehicleDataSource) vehicleDataSource.entities.removeAll();
    if (state.patrolEntity) {
      viewer?.entities.remove(state.patrolEntity);
      state.patrolEntity = null;
    }
    if (state.detourEntity) {
      viewer?.entities.remove(state.detourEntity);
      state.detourEntity = null;
    }
  }

  function getCongestionColor(status) {
    if (state.optimizingSignals) {
      return Cesium.Color.fromCssColorString('#10b981'); // optimize turns everything green
    }
    if (state.gridlockActive) {
      return Cesium.Color.fromCssColorString('#ef4444'); // gridlock turns everything red
    }
    
    switch (status) {
      case 'smooth': return Cesium.Color.fromCssColorString('#10b981');
      case 'moderate': return Cesium.Color.fromCssColorString('#f59e0b');
      case 'congested': return Cesium.Color.fromCssColorString('#ef4444');
      default: return Cesium.Color.fromCssColorString('#10b981');
    }
  }

  function renderRoadsOnMap() {
    if (!viewer || !trafficDataSource) return;
    trafficDataSource.entities.removeAll();

    state.roads.forEach(r => {
      const positions = r.points.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0));
      const color = getCongestionColor(r.congestion);
      
      // Determine thickness based on congestion
      const width = (r.congestion === 'congested' && !state.optimizingSignals) ? 4.5 : 3.0;

      trafficDataSource.entities.add({
        id: r.id,
        name: r.name,
        polyline: {
          positions,
          width,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.15,
            color: color.withAlpha(0.85)
          }),
          clampToGround: true
        },
        description: `<b>${r.name}</b><br/>Congestion Level: <span style="font-weight:700;color:${color.toCssColorString()}">${r.congestion.toUpperCase()}</span>`
      });
    });

    viewer.scene.requestRender();
  }

  // Animate active moving vehicles
  function animateVehicles(deltaTime) {
    if (!isEnabled || !viewer || !vehicleDataSource) return;

    vehicleDataSource.entities.removeAll();

    // Base speed factor (degrees per second, roughly)
    const baseSpeed = 0.0003;

    state.roads.forEach(r => {
      let speedFactor = 1.0;
      
      // Adjust speeds based on congestion, signals or gridlocks
      if (state.optimizingSignals) {
        speedFactor = 2.2;
      } else if (state.gridlockActive) {
        speedFactor = 0.15;
      } else {
        if (r.congestion === 'congested') speedFactor = 0.25;
        else if (r.congestion === 'moderate') speedFactor = 0.6;
      }

      const points = r.points;
      
      r.vehicles.forEach((v, vIndex) => {
        // Move vehicle progress forward
        const deltaProgress = (baseSpeed * v.speedOffset * speedFactor / r.lengthDeg) * deltaTime;
        v.progress = (v.progress + deltaProgress) % 1.0;

        const pos = interpolatePosition(points, v.progress);
        if (pos) {
          const cart3 = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 0.5);
          
          let color = getCongestionColor(r.congestion);
          if (state.optimizingSignals) color = Cesium.Color.fromCssColorString('#06b6d4'); // cyber blue glow

          vehicleDataSource.entities.add({
            position: cart3,
            point: {
              pixelSize: 7,
              color: color,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 1.5,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          });
        }
      });
    });

    // 🚔 Animate Traffic Patrol Entity
    if (state.patrolActive && state.patrolRoadId) {
      const road = state.roads.find(r => r.id === state.patrolRoadId);
      if (road) {
        // Patrol vehicle moves very quickly (takes ~5 seconds to cover the road)
        state.patrolProgress += (baseSpeed * 6.5 / road.lengthDeg) * deltaTime;
        
        if (state.patrolProgress >= 1.0) {
          // Patrol vehicle has completed clearing the street
          road.congestion = 'smooth';
          clearPatrol();
          renderRoadsOnMap();
          updatePanelUi(false);
        } else {
          const pos = interpolatePosition(road.points, state.patrolProgress);
          if (pos) {
            const cart3 = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 1.0);
            
            // Flashing Red & Blue Police Lights
            const flashTick = Math.floor(Date.now() / 150) % 2 === 0;
            const patrolColor = flashTick 
              ? Cesium.Color.fromCssColorString('#0070ff') 
              : Cesium.Color.fromCssColorString('#ff0022');

            if (!state.patrolEntity) {
              state.patrolEntity = viewer.entities.add({
                name: "🚔 HIGHWAY PATROL TASK FORCE",
                position: cart3,
                point: {
                  pixelSize: 12,
                  color: patrolColor,
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 2,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: {
                  text: '🚔 PATROL',
                  font: '9px Courier New, monospace',
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  fillColor: Cesium.Color.CYAN,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 2,
                  pixelOffset: new Cesium.Cartesian2(0, -14),
                  disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
              });
            } else {
              state.patrolEntity.position = cart3;
              state.patrolEntity.point.color = patrolColor;
            }
          }
        }
      } else {
        clearPatrol();
      }
    }

    viewer.scene.requestRender();
  }

  // Setup tab panel HTML content
  function updatePanelUi(isAltAlert) {
    const pane = document.getElementById('intel-panel-traffic');
    if (!pane) return;

    if (isAltAlert) {
      pane.innerHTML = `<div class="traffic-zoom-alert">
        <span style="font-size:20px;display:block;margin-bottom:8px;">📡 ALTITUDE WARNING</span>
        Zoom in below 15 km to activate street-level traffic monitoring.
      </div>`;
      return;
    }

    if (state.roads.length === 0) {
      pane.innerHTML = `<div class="intel-empty">Scanning viewport for roads...</div>`;
      return;
    }

    // Compute metrics
    const totalRoads = state.roads.length;
    const congestedCount = state.roads.filter(r => r.congestion === 'congested').length;
    const moderateCount = state.roads.filter(r => r.congestion === 'moderate').length;
    const smoothCount = state.roads.filter(r => r.congestion === 'smooth').length;
    
    // Congestion score (100% is full gridlock)
    let congestionScore = 0;
    if (state.gridlockActive) {
      congestionScore = 95;
    } else if (state.optimizingSignals) {
      congestionScore = 5;
    } else if (totalRoads > 0) {
      congestionScore = Math.round(((congestedCount * 1.0 + moderateCount * 0.4) / totalRoads) * 100);
    }

    let bannerHtml = '';
    if (state.optimizingSignals) {
      bannerHtml = `<div class="traffic-alert-banner" style="color:#10b981;border-color:rgba(16,185,129,0.3);background:rgba(16,185,129,0.08);">
        <span>🟢</span> <b>SIGNAL SYNC ACTIVE (Decongestion optimized)</b>
      </div>`;
    } else if (state.gridlockActive) {
      bannerHtml = `<div class="traffic-alert-banner" style="color:#ef4444;border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);">
        <span>🔴</span> <b>CRITICAL GRIDLOCK SIMULATED</b>
      </div>`;
    } else if (state.patrolActive) {
      const pRoad = state.roads.find(r => r.id === state.patrolRoadId);
      bannerHtml = `<div class="traffic-alert-banner" style="color:#38bdf8;border-color:rgba(56,189,248,0.3);background:rgba(56,189,248,0.08);">
        <span>🚔</span> <b>PATROL ENGAGED: clearing ${pRoad ? pRoad.name.split(' ')[0] : 'street'}</b>
      </div>`;
    } else if (state.reroutingActive) {
      const rRoad = state.roads.find(r => r.id === state.reroutedRoadId);
      bannerHtml = `<div class="traffic-alert-banner" style="color:#f59e0b;border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.08);">
        <span>⚠️</span> <b>DETOUR DEPLOYED on ${rRoad ? rRoad.name.split(' ')[0] : 'street'}</b>
      </div>`;
    }

    let statusText = "OPTIMAL FLOW";
    let statusColor = "#10b981";
    if (congestionScore > 65) {
      statusText = "HEAVY GRIDLOCK";
      statusColor = "#ef4444";
    } else if (congestionScore > 30) {
      statusText = "MODERATE DELAYS";
      statusColor = "#f59e0b";
    }

    let html = `
      <div class="traffic-overview-container">
        ${bannerHtml}
        
        <!-- Congestion Meter Card -->
        <div class="traffic-metric-card" style="border-color:${statusColor}33;background:${statusColor}0b;">
          <div class="traffic-metric-title">Sector Congestion Index</div>
          <div class="traffic-metric-value" style="color:${statusColor};">
            ${congestionScore}% <span>· ${statusText}</span>
          </div>
          <div class="traffic-progress-container">
            <div class="traffic-progress-fill" style="width:${congestionScore}%;background:${statusColor};"></div>
          </div>
          <div style="font-size:10px;color:var(--text-secondary);margin-top:8px;display:flex;justify-content:space-between;">
            <span>Flowing: ${smoothCount}</span>
            <span>Slow: ${moderateCount}</span>
            <span>Queued: ${congestedCount}</span>
          </div>
        </div>

        <!-- Operations Console -->
        <h3 class="traffic-actions-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M21 9H3M21 15H3M12 3v18"/></svg>
          Operations Center
        </h3>
        
        <div class="traffic-actions-grid">
          <button class="traffic-action-btn btn-optimize" id="btnOptSignals" title="Synch street signals to green" ${state.optimizingSignals ? 'disabled style="opacity:0.5"' : ''}>
            🚦 Sync Signals
          </button>
          <button class="traffic-action-btn btn-patrol" id="btnDepPatrol" title="Deploy patrol vehicle to clear blockages" ${state.patrolActive ? 'disabled style="opacity:0.5"' : ''}>
            🚔 Patrol Dispatch
          </button>
          <button class="traffic-action-btn btn-reroute" id="btnRerouteTraffic" title="Enact local detour paths" ${state.reroutingActive ? 'disabled style="opacity:0.5"' : ''}>
            ⚠️ detour path
          </button>
          <button class="traffic-action-btn btn-gridlock" id="btnTriggerGridlock" title="Simulate high traffic load">
            🚨 ${state.gridlockActive ? 'Clear Gridlock' : 'Gridlock Mode'}
          </button>
        </div>

        <!-- Monitored Roads List -->
        <h3 class="traffic-actions-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          Active Viewport Sectors
        </h3>
        
        <div class="traffic-roads-list">
    `;

    // Sort roads: congested first
    const sortedRoads = [...state.roads].sort((a,b) => {
      const getWeight = (c) => c === 'congested' ? 3 : c === 'moderate' ? 2 : 1;
      return getWeight(b.congestion) - getWeight(a.congestion);
    });

    sortedRoads.forEach(r => {
      const pillClass = r.congestion;
      let label = "SMOOTH";
      let speed = "68 km/h";
      if (r.congestion === 'congested') {
        label = "GRIDLOCK";
        speed = "8-12 km/h";
      } else if (r.congestion === 'moderate') {
        label = "MODERATE";
        speed = "32-40 km/h";
      }

      html += `
        <article class="traffic-card-road is-${r.congestion}" data-road-id="${r.id}">
          <div class="traffic-road-head">
            <span class="traffic-road-title" title="${r.name}">${r.name}</span>
            <span class="traffic-status-pill ${pillClass}">${label}</span>
          </div>
          <div class="traffic-road-meta">
            <span>Flow Speed: ${speed}</span>
            <span>Tracked: ${r.vehicles.length} units</span>
          </div>
        </article>
      `;
    });

    html += `
        </div>
      </div>
    `;

    pane.innerHTML = html;

    // Bind event handlers
    document.getElementById('btnOptSignals')?.addEventListener('click', optimizeSignalsAction);
    document.getElementById('btnDepPatrol')?.addEventListener('click', deployPatrolAction);
    document.getElementById('btnRerouteTraffic')?.addEventListener('click', rerouteTrafficAction);
    document.getElementById('btnTriggerGridlock')?.addEventListener('click', toggleGridlockAction);

    // Bind card clicks for fly-to
    pane.querySelectorAll('.traffic-card-road').forEach(card => {
      card.addEventListener('click', () => {
        const roadId = card.dataset.roadId;
        const road = state.roads.find(r => r.id === roadId);
        if (road && road.points.length > 0) {
          state.selectedRoadId = roadId;
          const center = road.points[Math.floor(road.points.length / 2)];
          
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 2200),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch: Cesium.Math.toRadians(-45),
              roll: 0
            },
            duration: 1.8
          });
        }
      });
    });
  }

  // 🟢 Action: Optimize Signals
  function optimizeSignalsAction() {
    if (state.optimizingSignals) return;
    state.optimizingSignals = true;
    
    // Clear other simulation states
    if (state.gridlockActive) clearGridlock();

    renderRoadsOnMap();
    updatePanelUi(false);

    // Reset after 15 seconds
    state.signalTimer = setTimeout(() => {
      state.optimizingSignals = false;
      renderRoadsOnMap();
      updatePanelUi(false);
    }, 15000);
  }

  // 🚔 Action: Deploy Patrol Task Force
  function deployPatrolAction() {
    if (state.patrolActive) return;

    // Find the most congested road
    const congestedRoad = state.roads.find(r => r.congestion === 'congested') || 
                          state.roads.find(r => r.congestion === 'moderate') ||
                          state.roads[0];

    if (!congestedRoad) return;

    state.patrolActive = true;
    state.patrolRoadId = congestedRoad.id;
    state.patrolProgress = 0;

    updatePanelUi(false);
  }

  function clearPatrol() {
    state.patrolActive = false;
    state.patrolRoadId = null;
    state.patrolProgress = 0;
    if (state.patrolEntity) {
      viewer?.entities.remove(state.patrolEntity);
      state.patrolEntity = null;
    }
  }

  // ⚠️ Action: Emergency Detour Reroute
  function rerouteTrafficAction() {
    if (state.reroutingActive) return;

    const congestedRoad = state.roads.find(r => r.congestion === 'congested') || 
                          state.roads.find(r => r.congestion === 'moderate') ||
                          state.roads[0];

    if (!congestedRoad || congestedRoad.points.length < 2) return;

    state.reroutingActive = true;
    state.reroutedRoadId = congestedRoad.id;

    // Generate detour points offset from the road to represent a physical bypass
    const midIdx = Math.floor(congestedRoad.points.length / 2);
    const start = congestedRoad.points[0];
    const end = congestedRoad.points[congestedRoad.points.length - 1];
    
    // Detour curves out to the side
    const curveOffsetLat = 0.0015;
    const curveOffsetLon = 0.0015;

    const detourPoints = [
      Cesium.Cartesian3.fromDegrees(start.lon, start.lat, 0),
      Cesium.Cartesian3.fromDegrees(start.lon + curveOffsetLon, start.lat + curveOffsetLat, 0),
      Cesium.Cartesian3.fromDegrees(end.lon + curveOffsetLon, end.lat + curveOffsetLat, 0),
      Cesium.Cartesian3.fromDegrees(end.lon, end.lat, 0)
    ];

    // Add a flashing detour route polyline
    state.detourEntity = viewer.entities.add({
      name: "⚠️ EMERGENCY TRAFFIC BYPASS DETOUR",
      polyline: {
        positions: detourPoints,
        width: 3.5,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#f59e0b'),
          dashLength: 16.0
        }),
        clampToGround: true
      }
    });

    // Animate the detour dashed line flashing
    let flash = false;
    const detourFlashTimer = setInterval(() => {
      if (!state.reroutingActive || !state.detourEntity) {
        clearInterval(detourFlashTimer);
        return;
      }
      flash = !flash;
      state.detourEntity.polyline.width = flash ? 5.0 : 2.5;
    }, 500);

    // Decongest target road
    congestedRoad.congestion = 'smooth';
    renderRoadsOnMap();
    updatePanelUi(false);

    // Revert detour after 12 seconds
    setTimeout(() => {
      clearReroute();
      updatePanelUi(false);
    }, 12000);
  }

  function clearReroute() {
    state.reroutingActive = false;
    state.reroutedRoadId = null;
    if (state.detourEntity) {
      viewer?.entities.remove(state.detourEntity);
      state.detourEntity = null;
    }
  }

  // 🔴 Action: Toggle Gridlock
  function toggleGridlockAction() {
    if (state.gridlockActive) {
      clearGridlock();
    } else {
      state.gridlockActive = true;
      if (state.optimizingSignals) {
        state.optimizingSignals = false;
        clearTimeout(state.signalTimer);
      }
    }
    renderRoadsOnMap();
    updatePanelUi(false);
  }

  function clearGridlock() {
    state.gridlockActive = false;
  }

  function setTrafficEnabled(on) {
    isEnabled = on;
    ensureLayers();
    if (!viewer) return;

    clearMapEntities();

    if (on) {
      // Refresh traffic data periodically (every 7 seconds)
      fetchTrafficData();
      updateTimer = setInterval(fetchTrafficData, 7000);

      // Listen for camera movements to load new OSM roads on map view updates
      cameraListener = viewer.camera.moveEnd.addEventListener(fetchTrafficData);

      // Register delta-time animation loop for vehicles
      let lastTime = Date.now();
      clockListener = viewer.clock.onTick.addEventListener(() => {
        const now = Date.now();
        const deltaTime = (now - lastTime) / 1000;
        lastTime = now;
        animateVehicles(deltaTime);
      });
    } else {
      clearInterval(updateTimer);
      updateTimer = null;

      if (cameraListener) {
        cameraListener(); // unsubscribe camera moveEnd
        cameraListener = null;
      }
      if (clockListener) {
        clockListener(); // unsubscribe animation tick
        clockListener = null;
      }

      clearPatrol();
      clearReroute();
      clearGridlock();
      state.roads = [];
      state.lastBbox = null;

      const pane = document.getElementById('intel-panel-traffic');
      if (pane) pane.innerHTML = `<div class="intel-empty">Enable Live Traffic to monitor road networks.</div>`;
    }
    viewer.scene.requestRender();
  }

  function initUi() {
    document.getElementById('toggleTraffic')?.addEventListener('change', (e) => {
      setTrafficEnabled(e.target.checked);
    });
  }

  function boot() {
    const wait = setInterval(() => {
      if (!window.viewer) return;
      clearInterval(wait);
      ensureLayers();
      initUi();
    }, 200);
  }

  boot();
})();
