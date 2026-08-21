/**
 * Live maritime layer — vessels (AIS) + major shipping lane polylines.
 */
(function () {
  'use strict';

  const POLL_MS = 3000;
  const SCALE = new Cesium.NearFarScalar(5e3, 1.5, 8e6, 0.45);

  let vesselBillboards = null;
  let routesDataSource = null;
  let pollTimer = null;
  let routesLoaded = false;

  const vesselsById = {};
  const vesselMarkers = {};
  const vesselHistory = {};
  let selectedVesselId = null;
  let selectedWakeEntity = null;

  function getViewer() {
    return window.viewer;
  }

  function buildShipIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.translate(24, 24);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(10, 12);
    ctx.lineTo(0, 8);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return canvas.toDataURL('image/png');
  }

  const SHIP_ICON = buildShipIcon();

  function cogToRotation(cog) {
    return -Cesium.Math.toRadians(Number(cog) || 0);
  }

  function billboardOpts(v, position) {
    const mil = !!v.isMilitary;
    return {
      image: SHIP_ICON,
      position,
      width: mil ? 30 : 24,
      height: mil ? 30 : 24,
      rotation: cogToRotation(v.cog ?? v.heading),
      color: Cesium.Color.fromCssColorString(mil ? '#f87171' : '#38bdf8'),
      scaleByDistance: SCALE,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      show: true,
    };
  }

  function ensureLayers() {
    const viewer = getViewer();
    if (!viewer) return null;

    if (!vesselBillboards) {
      vesselBillboards = viewer.scene.primitives.add(new Cesium.BillboardCollection());
      vesselBillboards.show = false;
    }
    if (!routesDataSource) {
      routesDataSource = new Cesium.CustomDataSource('shipping-lanes');
      viewer.dataSources.add(routesDataSource);
      routesDataSource.show = false;
    }
    return viewer;
  }

  async function loadShippingRoutes() {
    if (routesLoaded) return;
    const viewer = ensureLayers();
    if (!viewer || !routesDataSource) return;

    try {
      const res = await fetch('/api/shipping-routes');
      const data = await res.json();
      routesDataSource.entities.removeAll();

      (data.routes || []).forEach((route) => {
        const positions = [];
        route.coordinates.forEach((c) => {
          positions.push(Cesium.Cartesian3.fromDegrees(c[1], c[0], 0));
        });
        routesDataSource.entities.add({
          id: route.id,
          name: route.name,
          polyline: {
            positions,
            width: 3,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.15,
              color: Cesium.Color.fromCssColorString(route.color || '#38bdf8').withAlpha(0.85),
            }),
            clampToGround: true,
          },
          description: `<b>${route.name}</b><br/>Major commercial shipping lane`,
        });
      });
      routesLoaded = true;
      viewer.scene.requestRender();
    } catch (err) {
      console.warn('[MARITIME] Routes load failed:', err.message);
    }
  }

  function recordHistory(v) {
    if (!vesselHistory[v.id]) vesselHistory[v.id] = [];
    const h = vesselHistory[v.id];
    const last = h[h.length - 1];
    if (!last || Math.hypot(v.lat - last.lat, v.lon - last.lon) > 0.003) {
      h.push({ lat: v.lat, lon: v.lon });
      if (h.length > 40) h.shift();
    }
  }

  function showVesselPopup(v) {
    const popup = document.getElementById('vesselPopup');
    if (!popup) return;
    const mil = !!v.isMilitary;
    const color = mil ? '#f87171' : '#38bdf8';
    document.getElementById('vesselPopupTitle').textContent = mil
      ? `⚔ ${v.name}`
      : `🚢 ${v.name}`;
    const badge = document.getElementById('vesselPopupBadge');
    badge.textContent = mil ? 'Naval / Military AIS' : 'Commercial Vessel';
    badge.style.color = color;
    badge.style.borderColor = color + '55';
    badge.style.background = color + '22';

    const kts = (v.sog ?? 0).toFixed(1);
    const rows = [
      ['MMSI', v.mmsi],
      ['Position', `${v.lat.toFixed(4)}°, ${v.lon.toFixed(4)}°`],
      ['Speed', `${kts} kn`],
      ['Course', `${Math.round(v.cog || 0)}°`],
      ['Source', v.source || '—'],
    ];
    if (v.callsign) rows.push(['Callsign', v.callsign]);
    if (v.destination) rows.push(['Destination', v.destination]);

    document.getElementById('vesselPopupDetails').innerHTML = rows
      .map(([k, val]) => `<div class="popup-row"><span>${k}</span><span>${val}</span></div>`)
      .join('');

    document.getElementById('vesselPopupFlyTo').onclick = () => {
      getViewer()?.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 120000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 2,
      });
    };

    popup.classList.remove('hidden');
  }

  function clearVesselSelection() {
    selectedVesselId = null;
    document.getElementById('vesselPopup')?.classList.add('hidden');
    if (selectedWakeEntity) {
      getViewer()?.entities.remove(selectedWakeEntity);
      selectedWakeEntity = null;
    }
  }

  function selectVessel(id) {
    const v = vesselsById[id];
    if (!v) return;
    selectedVesselId = id;
    showVesselPopup(v);

    const viewer = getViewer();
    if (!viewer) return;
    if (selectedWakeEntity) viewer.entities.remove(selectedWakeEntity);

    const hist = vesselHistory[id] || [{ lat: v.lat, lon: v.lon }];
    const positions = hist.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0));
    positions.push(Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 0));

    selectedWakeEntity = viewer.entities.add({
      polyline: {
        positions,
        width: 2,
        material: Cesium.Color.fromCssColorString(v.isMilitary ? '#f87171' : '#38bdf8').withAlpha(0.9),
        clampToGround: true,
      },
    });
  }

  async function refreshVessels() {
    if (!vesselBillboards?.show) return;
    const viewer = ensureLayers();
    if (!viewer) return;

    try {
      const res = await fetch(`/api/vessels?_=${Date.now()}`);
      const data = await res.json();
      const list = data.vessels || [];
      const status = document.getElementById('maritimeFeedStatus');
      if (status) {
        status.textContent = `${list.length} (${data.military || 0} mil) · ${data.mode || ''}`;
      }

      const seen = new Set();
      list.forEach((v) => {
        if (v.lat == null || v.lon == null) return;
        seen.add(v.id);
        vesselsById[v.id] = v;
        recordHistory(v);
        const pos = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, 0);
        const opts = billboardOpts(v, pos);
        if (vesselMarkers[v.id]) {
          const b = vesselMarkers[v.id];
          b.position = pos;
          b.rotation = opts.rotation;
          b.color = opts.color;
          b.width = opts.width;
          b.height = opts.height;
        } else {
          const b = vesselBillboards.add(opts);
          b.vesselId = v.id;
          vesselMarkers[v.id] = b;
        }
      });

      Object.keys(vesselMarkers).forEach((id) => {
        if (!seen.has(id)) {
          vesselBillboards.remove(vesselMarkers[id]);
          delete vesselMarkers[id];
          delete vesselsById[id];
          delete vesselHistory[id];
        }
      });

      if (selectedVesselId && vesselsById[selectedVesselId]) {
        showVesselPopup(vesselsById[selectedVesselId]);
      }

      viewer.scene.requestRender();
    } catch (err) {
      console.warn('[MARITIME] Vessel refresh failed:', err.message);
    }
  }

  function setMaritimeEnabled(on) {
    ensureLayers();
    const opts = document.getElementById('maritimeOptionsContainer');
    if (opts) opts.style.display = on ? 'flex' : 'none';

    if (vesselBillboards) vesselBillboards.show = on;
    const routesToggle = document.getElementById('toggleShippingRoutes');
    if (routesDataSource) {
      routesDataSource.show = on && routesToggle?.checked !== false;
    }

    if (on) {
      loadShippingRoutes().then(() => {
        if (routesDataSource) {
          routesDataSource.show = routesToggle?.checked !== false;
        }
      });
      refreshVessels();
      pollTimer = setInterval(refreshVessels, POLL_MS);
    } else {
      clearInterval(pollTimer);
      pollTimer = null;
      clearVesselSelection();
    }
    getViewer()?.scene.requestRender();
  }

  function initUi() {
    document.getElementById('toggleMaritime')?.addEventListener('change', (e) => {
      setMaritimeEnabled(e.target.checked);
    });
    document.getElementById('toggleShippingRoutes')?.addEventListener('change', (e) => {
      if (routesDataSource) routesDataSource.show = e.target.checked;
      getViewer()?.scene.requestRender();
    });
    document.getElementById('vesselPopupClose')?.addEventListener('click', clearVesselSelection);
  }

  function boot() {
    const wait = setInterval(() => {
      if (!window.viewer) return;
      clearInterval(wait);
      ensureLayers();
      initUi();
    }, 200);
  }

  window.selectVessel = selectVessel;
  window.clearVesselSelection = clearVesselSelection;
  window.getVesselIdFromPick = (picked) => picked?.primitive?.vesselId || null;
  window.getVesselById = (id) => vesselsById[id];

  boot();
})();
