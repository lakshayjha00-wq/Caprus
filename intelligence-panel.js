/**
 * Intelligence dock: Crisis Zones, Tactical Alerts, Thermal — panels + Cesium map layers
 */
(function () {
  'use strict';

  const POLL_MS = 60_000;
  const THERMAL_POLL_MS = 90_000;
  const KM_TO_M = 1000;

  let crisisZones = [];
  let zoneEntityMap = new Map();
  let thermalEntityMap = new Map();
  let alertPulseEntities = [];
  let pulseStart = Date.now();
  let pulseListener = null;
  let ws = null;

  const state = {
    layers: { crisis: true, thermal: true, tactical: true },
    zoneThermalCount: {},
    zoneAlertActive: {},
  };

  /** Cesium 1.x: LabelStyle (not CesiumLabelStyle) */
  function labelStyleFillOutline() {
    if (typeof Cesium === 'undefined') return undefined;
    const ls = Cesium.LabelStyle;
    if (ls && ls.FILL_AND_OUTLINE !== undefined) return ls.FILL_AND_OUTLINE;
    return undefined;
  }

  function defaultLabel(overrides) {
    const label = {
      font: 'bold 11px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
    const style = labelStyleFillOutline();
    if (style !== undefined) label.style = style;
    return Object.assign(label, overrides);
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function findZoneForPoint(lat, lon) {
    for (const z of crisisZones) {
      const d = haversineKm(lat, lon, z.center.lat, z.center.lon);
      if (d <= z.radius_km) return { zone: z, distance_km: d };
    }
    return null;
  }

  function parseZoneIdFromAlert(alert) {
    if (!alert?.id) return null;
    for (const z of crisisZones) {
      if (alert.id.includes(z.id)) return z.id;
    }
    if (alert.summary) {
      const hit = crisisZones.find((z) => alert.summary.includes(z.name));
      if (hit) return hit.id;
    }
    return null;
  }

  function getViewer() {
    return window.viewer;
  }

  function ensureCesium() {
    if (typeof Cesium === 'undefined') {
      throw new Error('Cesium library not loaded');
    }
    return Cesium;
  }

  function ensureDataSources() {
    const viewer = getViewer();
    if (!viewer) return null;
    ensureCesium();

    if (!window.intelCrisisDataSource) {
      window.intelCrisisDataSource = new Cesium.CustomDataSource('crisis-zones');
      viewer.dataSources.add(window.intelCrisisDataSource);
    }
    if (!window.intelThermalDataSource) {
      window.intelThermalDataSource = new Cesium.CustomDataSource('thermal-events');
      viewer.dataSources.add(window.intelThermalDataSource);
    }
    if (!window.intelTacticalDataSource) {
      window.intelTacticalDataSource = new Cesium.CustomDataSource('tactical-highlights');
      viewer.dataSources.add(window.intelTacticalDataSource);
    }

    window.intelCrisisDataSource.show = state.layers.crisis;
    window.intelThermalDataSource.show = state.layers.thermal;
    window.intelTacticalDataSource.show = state.layers.tactical;

    return viewer;
  }

  function startPulseAnimation() {
    if (pulseListener) return;
    const viewer = getViewer();
    if (!viewer) return;

    pulseListener = viewer.clock.onTick.addEventListener(() => {
      const t = (Date.now() - pulseStart) / 500;
      const pulse = 10 + 8 * Math.abs(Math.sin(t));

      thermalEntityMap.forEach((ent) => setEntityPointSize(ent, pulse));

      alertPulseEntities.forEach((ent) => {
        setEntityPointSize(ent, 14 + 10 * Math.abs(Math.sin(t * 1.3)));
        if (ent.ellipse) {
          const alpha = 0.18 + 0.1 * Math.abs(Math.sin(t));
          ent.ellipse.material = Cesium.Color.fromCssColorString('#ffab00').withAlpha(alpha);
        }
      });

      viewer.scene.requestRender();
    });
  }

  function setEntityPointSize(entity, size) {
    if (!entity?.point?.pixelSize) return;
    const prop = entity.point.pixelSize;
    if (typeof prop.setValue === 'function') prop.setValue(size);
    else entity.point.pixelSize = size;
  }

  function flyToLatLon(lat, lon, altM = 400000) {
    const viewer = getViewer();
    if (!viewer || Number.isNaN(lat) || Number.isNaN(lon)) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
      duration: 2.2,
    });
  }

  function renderCrisisZonesOnMap() {
    try {
      const viewer = ensureDataSources();
      if (!viewer || !window.intelCrisisDataSource) return;

      const ds = window.intelCrisisDataSource;
      ds.entities.removeAll();
      zoneEntityMap.clear();

      crisisZones.forEach((zone) => {
        if (!zone?.center || zone.radius_km == null) return;

        const active =
          (state.zoneThermalCount[zone.id] || 0) > 0 || state.zoneAlertActive[zone.id];
        const outline = active ? '#ff6d00' : '#ff5252';
        const fillAlpha = active ? 0.22 : 0.1;
        const radiusM = zone.radius_km * KM_TO_M;

        const ent = ds.entities.add({
          id: zone.id,
          name: zone.name,
          position: Cesium.Cartesian3.fromDegrees(zone.center.lon, zone.center.lat),
          ellipse: {
            semiMajorAxis: radiusM,
            semiMinorAxis: radiusM,
            material: Cesium.Color.fromCssColorString('#ff1744').withAlpha(fillAlpha),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(outline).withAlpha(0.95),
            outlineWidth: active ? 4 : 2,
            height: 0,
          },
          label: defaultLabel({
            text: zone.name.toUpperCase(),
            fillColor: Cesium.Color.fromCssColorString('#ff8a80'),
            outlineWidth: 3,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 12000000),
          }),
          description: buildZoneDescription(zone, active),
        });

        zoneEntityMap.set(zone.id, ent);
      });

      viewer.scene.requestRender();
    } catch (err) {
      console.error('[INTEL] Crisis zone map render failed:', err);
    }
  }

  function buildZoneDescription(zone, active) {
    const thermal = state.zoneThermalCount[zone.id] || 0;
    const alert = state.zoneAlertActive[zone.id] ? 'YES' : 'NO';
    return (
      `<b>${zone.name}</b><br/>` +
      `Radius: ${zone.radius_km} km<br/>` +
      `Thermal events in zone: ${thermal}<br/>` +
      `Active tactical alert: ${alert}<br/>` +
      `${zone.intel_summary || zone.description || ''}`
    );
  }

  function renderThermalOnMap(events) {
    try {
      const viewer = ensureDataSources();
      if (!viewer || !window.intelThermalDataSource) return;

      const ds = window.intelThermalDataSource;
      ds.entities.removeAll();
      thermalEntityMap.clear();
      state.zoneThermalCount = {};

      (events || []).forEach((ev, idx) => {
      const lat = Number(ev.latitude);
      const lon = Number(ev.longitude);
      if (Number.isNaN(lat) || Number.isNaN(lon)) return;

      const zoneId = ev.crisis_zone_id || findZoneForPoint(lat, lon)?.zone?.id;
      if (zoneId) {
        state.zoneThermalCount[zoneId] = (state.zoneThermalCount[zoneId] || 0) + 1;
      }

      const brightness = Number(ev.brightness) || 0;
      const inZone = !!zoneId;
      const color = inZone
        ? Cesium.Color.fromCssColorString('#ff0000')
        : Cesium.Color.fromCssColorString('#ff5252');

      const ent = ds.entities.add({
        id: `thermal-${ev.id ?? idx}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: inZone ? 14 : 10,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: '🔥',
          font: '14px sans-serif',
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2500000),
        },
        description:
          `<b>Thermal detection</b><br/>` +
          `Brightness: ${brightness.toFixed(1)} K<br/>` +
          `Confidence: ${ev.confidence || '—'}<br/>` +
          `Sensor: ${ev.sensor || '—'}<br/>` +
          (ev.crisis_zone_name
            ? `<span style="color:#ff5252">Crisis zone: ${ev.crisis_zone_name}</span>`
            : 'Outside crisis zones'),
      });

      thermalEntityMap.set(ent.id, ent);
      });

      renderCrisisZonesOnMap();
      startPulseAnimation();
      viewer.scene.requestRender();
    } catch (err) {
      console.error('[INTEL] Thermal map render failed:', err);
      throw err;
    }
  }

  function renderTacticalHighlightsOnMap(alerts) {
    try {
      const viewer = ensureDataSources();
      if (!viewer || !window.intelTacticalDataSource) return;

      const ds = window.intelTacticalDataSource;
      ds.entities.removeAll();
      alertPulseEntities = [];

      (alerts || []).forEach((alert) => {
      const zoneId = parseZoneIdFromAlert(alert);
      if (!zoneId) return;
      const zone = crisisZones.find((z) => z.id === zoneId);
      if (!zone) return;

      state.zoneAlertActive[zoneId] = true;

      const ent = ds.entities.add({
        id: `alert-${alert.id}`,
        position: Cesium.Cartesian3.fromDegrees(zone.center.lon, zone.center.lat),
        point: {
          pixelSize: 18,
          color: Cesium.Color.fromCssColorString('#ffea00'),
          outlineColor: Cesium.Color.RED,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        ellipse: {
          semiMajorAxis: zone.radius_km * KM_TO_M * 0.15,
          semiMinorAxis: zone.radius_km * KM_TO_M * 0.15,
          material: Cesium.Color.fromCssColorString('#ffab00').withAlpha(0.25),
          outline: true,
          outlineColor: Cesium.Color.YELLOW,
          outlineWidth: 2,
          height: 5000,
        },
        label: defaultLabel({
          text: 'CRITICAL',
          fillColor: Cesium.Color.YELLOW,
          pixelOffset: new Cesium.Cartesian2(0, -24),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        }),
        description: `<b>${alert.severity}</b><br/>${alert.summary || ''}`,
      });

      alertPulseEntities.push(ent);
      });

      renderCrisisZonesOnMap();
      startPulseAnimation();
      viewer.scene.requestRender();
    } catch (err) {
      console.error('[INTEL] Tactical map render failed:', err);
    }
  }

  // ─── Panel UI ───

  function setPanelHtml(tabId, html) {
    const el = document.getElementById(`intel-panel-${tabId}`);
    if (el) el.innerHTML = html;
  }

  function renderCrisisZonesPanel() {
    if (!crisisZones.length) {
      setPanelHtml(
        'crisis',
        '<div class="intel-empty">Loading crisis zones…</div>'
      );
      return;
    }

    let html = '';
    crisisZones.forEach((z) => {
      const thermal = state.zoneThermalCount[z.id] || 0;
      const alert = state.zoneAlertActive[z.id];
      const badge = alert
        ? '<span class="intel-badge critical">CRITICAL</span>'
        : thermal > 0
          ? `<span class="intel-badge thermal">${thermal} thermal</span>`
          : '<span class="intel-badge clear">CLEAR</span>';

      html += `<article class="intel-card intel-card-zone ${alert ? 'is-alert' : thermal ? 'is-thermal' : ''}" data-zone-id="${z.id}" data-lat="${z.center.lat}" data-lon="${z.center.lon}">
        <header class="intel-card-head">
          <h4>${z.name}</h4>
          ${badge}
        </header>
        <p class="intel-card-meta">${z.radius_km} km ops radius · ${z.center.lat.toFixed(2)}°, ${z.center.lon.toFixed(2)}°</p>
        <p class="intel-card-desc">${z.intel_summary || z.description || ''}</p>
      </article>`;
    });

    setPanelHtml('crisis', html);
    bindCardFlyTo('#intel-panel-crisis .intel-card-zone');
  }

  function renderTacticalPanel(alerts) {
    if (!alerts?.length) {
      setPanelHtml(
        'tactical',
        '<div class="intel-empty">No tactical alerts in the last 24h.</div>'
      );
      return;
    }

    let html = '';
    alerts.forEach((a) => {
      const zoneId = parseZoneIdFromAlert(a);
      const zone = crisisZones.find((z) => z.id === zoneId);
      const sev = (a.severity || 'INFO').toUpperCase();
      const ts = a.timestamp
        ? new Date(a.timestamp).toLocaleString()
        : '—';
      html += `<article class="intel-card intel-card-alert ${sev === 'CRITICAL' ? 'is-critical' : ''}" data-zone-id="${zoneId || ''}" data-lat="${zone?.center.lat ?? ''}" data-lon="${zone?.center.lon ?? ''}">
        <header class="intel-card-head">
          <h4>${a.alert_type || 'ALERT'}</h4>
          <span class="intel-badge critical">${sev}</span>
        </header>
        <p class="intel-card-summary">${a.summary || '—'}</p>
        <p class="intel-card-meta">${ts}${zone ? ` · ${zone.name}` : ''}</p>
      </article>`;
    });

    setPanelHtml('tactical', html);
    bindCardFlyTo('#intel-panel-tactical .intel-card');
  }

  function renderThermalPanel(events) {
    if (!events?.length) {
      setPanelHtml(
        'thermal',
        '<div class="intel-empty">No thermal detections in database.</div>'
      );
      return;
    }

    const inZone = events.filter((e) => e.in_crisis_zone || e.crisis_zone_id);
    let html = `<div class="intel-stat">${inZone.length} of ${events.length} inside crisis zones</div>`;

    events.forEach((ev) => {
      const lat = Number(ev.latitude);
      const lon = Number(ev.longitude);
      const brightness = Number(ev.brightness) || 0;
      const sev =
        brightness >= 400 ? 'CRITICAL' : brightness >= 330 ? 'HIGH' : 'MODERATE';
      const zoneLabel = ev.crisis_zone_name
        ? ev.crisis_zone_name
        : 'Unassigned sector';

      html += `<article class="intel-card intel-card-thermal ${ev.in_crisis_zone ? 'in-zone' : ''}" data-lat="${lat}" data-lon="${lon}">
        <header class="intel-card-head">
          <h4>🔥 ${brightness.toFixed(0)} K</h4>
          <span class="intel-badge ${sev === 'CRITICAL' ? 'critical' : 'thermal'}">${sev}</span>
        </header>
        <p class="intel-card-meta">${lat.toFixed(3)}°, ${lon.toFixed(3)}° · ${ev.sensor || 'FIRMS'}</p>
        <p class="intel-card-zone-link">${zoneLabel}</p>
      </article>`;
    });

    setPanelHtml('thermal', html);
    bindCardFlyTo('#intel-panel-thermal .intel-card-thermal');
  }

  function bindCardFlyTo(selector) {
    document.querySelectorAll(selector).forEach((card) => {
      card.addEventListener('click', () => {
        const lat = parseFloat(card.dataset.lat);
        const lon = parseFloat(card.dataset.lon);
        const zoneId = card.dataset.zoneId;
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          flyToLatLon(lat, lon, zoneId ? 900000 : 250000);
        }
      });
    });
  }

  // ─── Data fetch ───

  async function loadCrisisZones() {
    try {
      const res = await fetch('/api/crisis-zones');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      crisisZones = data.zones || [];
      renderCrisisZonesPanel();
      try {
        renderCrisisZonesOnMap();
      } catch (mapErr) {
        console.error('[INTEL] Map layers:', mapErr);
      }
    } catch (err) {
      setPanelHtml('crisis', `<div class="intel-empty">Failed to load zones: ${err.message}</div>`);
    }
  }

  async function loadTacticalAlerts() {
    try {
      const res = await fetch('/api/tactical-alerts');
      const data = await res.json();
      const alerts = data.alerts || [];
      renderTacticalPanel(alerts);
      renderTacticalHighlightsOnMap(
        alerts.filter((a) => (a.severity || '').toUpperCase() === 'CRITICAL')
      );
    } catch (err) {
      setPanelHtml('tactical', `<div class="intel-empty">Alerts unavailable.</div>`);
    }
  }

  async function loadThermalEvents() {
    try {
      const res = await fetch('/api/thermal-events?limit=80');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.message || data.error || 'API error');
      const events = data.events || [];
      if (data.zones?.length) crisisZones = data.zones;
      renderThermalPanel(events);
      try {
        renderThermalOnMap(events);
      } catch (mapErr) {
        console.error('[INTEL] Thermal map:', mapErr);
      }
      if (crisisZones.length) renderCrisisZonesPanel();
    } catch (err) {
      setPanelHtml('thermal', `<div class="intel-empty">Thermal feed offline — ${err.message}</div>`);
    }
  }

  function connectThreatWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws/threats`);

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'CRISIS_ZONE_THREAT') {
          prependLiveAlert(msg);
          loadTacticalAlerts();
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setTimeout(connectThreatWebSocket, 8000);
    };
  }

  function prependLiveAlert(msg) {
    const list = document.getElementById('intel-panel-tactical');
    if (!list) return;
    const empty = list.querySelector('.intel-empty');
    if (empty) empty.remove();

    const card = document.createElement('article');
    card.className = 'intel-card intel-card-alert is-critical is-live';
    card.dataset.lat = msg.zone?.center?.lat;
    card.dataset.lon = msg.zone?.center?.lon;
    card.innerHTML = `
      <header class="intel-card-head"><h4>LIVE — ${msg.zone?.name || 'Zone breach'}</h4><span class="intel-badge critical">CRITICAL</span></header>
      <p class="intel-card-summary">${msg.breach_detail?.total_count || 0} assets inside zone boundary</p>
      <p class="intel-card-meta">${new Date(msg.timestamp).toLocaleString()}</p>`;
    card.addEventListener('click', () => {
      flyToLatLon(Number(card.dataset.lat), Number(card.dataset.lon), 900000);
    });
    list.prepend(card);

    if (msg.zone?.id) state.zoneAlertActive[msg.zone.id] = true;
    renderCrisisZonesOnMap();
  }

  function initTabs() {
    document.querySelectorAll('.intel-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        document.querySelectorAll('.intel-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.intel-panel-pane').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`intel-panel-${name}`)?.classList.add('active');
      });
    });
  }

  function initLayerToggles() {
    const map = [
      ['toggleCrisisZones', 'crisis'],
      ['toggleThermalMap', 'thermal'],
      ['toggleTacticalMap', 'tactical'],
    ];
    map.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        state.layers[key] = el.checked;
        ensureDataSources();
        if (key === 'crisis' && window.intelCrisisDataSource) {
          window.intelCrisisDataSource.show = el.checked;
        }
        if (key === 'thermal' && window.intelThermalDataSource) {
          window.intelThermalDataSource.show = el.checked;
        }
        if (key === 'tactical' && window.intelTacticalDataSource) {
          window.intelTacticalDataSource.show = el.checked;
        }
        getViewer()?.scene.requestRender();
      });
    });
  }

  function initDockCollapse() {
    const btn = document.getElementById('intelDockToggle');
    const dock = document.getElementById('intel-dock');
    if (!btn || !dock) return;
    btn.addEventListener('click', () => dock.classList.toggle('collapsed'));
  }

  function boot() {
    const wait = setInterval(() => {
      if (!window.viewer || typeof Cesium === 'undefined') return;
      clearInterval(wait);
      try {
        ensureCesium();
      } catch (err) {
        console.error('[INTEL]', err.message);
        return;
      }
      ensureDataSources();
      initTabs();
      initLayerToggles();
      initDockCollapse();
      loadCrisisZones().then(() => {
        loadThermalEvents();
        loadTacticalAlerts();
      });
      connectThreatWebSocket();
      setInterval(loadTacticalAlerts, POLL_MS);
      setInterval(loadThermalEvents, THERMAL_POLL_MS);
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
