/**
 * GODSEYE globe — OpenStreetMap base maps + Cesium 3D terrain & OSM buildings.
 */
(function () {
  'use strict';

  const state = {
    mode: 'osm',
    currentStyle: 'photorealistic',
    buildingsTileset: null,
    trafficOverlayLayer: null,
  };

  let currentBaseLayer = null;

  function withTimeout(promise, ms = 2500, label = 'operation') {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  }

  function osmImagery(layerKey, credit) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return new Cesium.UrlTemplateImageryProvider({
      url: `${origin}/api/tiles/{z}/{x}/{y}.png?lyrs=${layerKey}`,
      credit: credit || '© OpenStreetMap contributors',
      maximumLevel: layerKey === 'opentopomap' ? 17 : 21,
      enablePickFeatures: false,
    });
  }

  const STYLE_MAP = {
    streets: { layer: 'osm', credit: '© OpenStreetMap contributors' },
    satellite: { layer: 's', credit: 'Google Satellite' },
    terrain: { layer: 'opentopomap', credit: '© OpenTopoMap' },
    dark: { layer: 'carto-dark', credit: '© CARTO' },
    transport: { layer: 'osm-transport', credit: '© OpenStreetMap France' },
    photorealistic: { layer: 's', credit: 'Google Satellite' },
  };

  async function fetchMapsConfig() {
    const res = await fetch('/api/maps-config');
    if (!res.ok) throw new Error(`maps-config HTTP ${res.status}`);
    return res.json();
  }

  function applyIonToken(token) {
    if (token) Cesium.Ion.defaultAccessToken = token;
  }

  function setBaseOsmLayer(viewer, style) {
    const cfg = STYLE_MAP[style] || STYLE_MAP.photorealistic;
    state.currentStyle = style;
    
    if (currentBaseLayer) {
      viewer.imageryLayers.remove(currentBaseLayer, true);
      currentBaseLayer = null;
    }
    
    currentBaseLayer = viewer.imageryLayers.addImageryProvider(osmImagery(cfg.layer, cfg.credit), 0);
    state.mode = 'osm';
    viewer.scene.globe.show = true;
    syncTrafficOverlay(viewer);
    viewer.scene.requestRender();
  }

  function syncTrafficOverlay(viewer) {
    const trafficOn = document.getElementById('toggleTraffic')?.checked;
    if (state.trafficOverlayLayer) {
      viewer.imageryLayers.remove(state.trafficOverlayLayer, false);
      state.trafficOverlayLayer = null;
    }
    if (trafficOn && state.currentStyle !== 'transport') {
      state.trafficOverlayLayer = viewer.imageryLayers.addImageryProvider(
        osmImagery('carto-voyager', 'Traffic context © CARTO'),
        1
      );
      state.trafficOverlayLayer.alpha = 0.35;
    }
  }

  async function applyWorldTerrain(viewer) {
    if (!Cesium.Ion.defaultAccessToken) {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      viewer.scene.globe.depthTestAgainstTerrain = false;
      return false;
    }
    try {
      if (typeof Cesium.createWorldTerrainAsync === 'function') {
        viewer.terrainProvider = await withTimeout(
          Cesium.createWorldTerrainAsync({
            requestWaterMask: true,
            requestVertexNormals: true,
          }),
          3000,
          'World terrain'
        );
      } else if (Cesium.Terrain?.fromWorldTerrain) {
        viewer.terrainProvider = Cesium.Terrain.fromWorldTerrain();
      } else {
        viewer.terrainProvider = await withTimeout(
          Cesium.CesiumTerrainProvider.fromIonAssetId(1),
          3000,
          'Ion terrain'
        );
      }
      viewer.scene.globe.depthTestAgainstTerrain = true;
      return true;
    } catch (err) {
      console.warn('[GLOBE] Terrain unavailable:', err.message);
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
      viewer.scene.globe.depthTestAgainstTerrain = false;
      return false;
    }
  }

  async function loadOsmBuildings(viewer) {
    if (!Cesium.Ion.defaultAccessToken) return null;
    try {
      let tileset;
      if (typeof Cesium.createOsmBuildingsAsync === 'function') {
        tileset = await withTimeout(Cesium.createOsmBuildingsAsync(), 3000, 'OSM buildings');
      } else {
        tileset = await withTimeout(
          Cesium.Cesium3DTileset.fromIonAssetId(96188),
          3000,
          'OSM buildings'
        );
      }
      viewer.scene.primitives.add(tileset);
      state.buildingsTileset = tileset;
      tileset.show = document.getElementById('toggleBuildings')?.checked !== false;
      return tileset;
    } catch (err) {
      console.warn('[GLOBE] OSM 3D buildings skipped:', err.message);
      return null;
    }
  }

  async function loadOsmGlobe(viewer) {
    viewer.scene.globe.show = true;
    viewer.scene.globe.maximumScreenSpaceError = 2;
    setBaseOsmLayer(viewer, state.currentStyle || 'photorealistic');
    await applyWorldTerrain(viewer);
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    loadOsmBuildings(viewer);
  }

  function setGlobeMapStyle(viewer, style) {
    if (!viewer) return;
    setBaseOsmLayer(viewer, style || 'photorealistic');
    if (style === 'terrain') {
      applyWorldTerrain(viewer);
    }
  }

  async function initGoogleEarthGlobe(viewer, opts = {}) {
    const setProgress = opts.setProgress || (() => {});

    setProgress(35, 'Loading OpenStreetMap...');

    let config = { cesiumIonToken: '' };
    try {
      config = await withTimeout(fetchMapsConfig(), 2000, 'maps-config');
    } catch (err) {
      console.warn('[GLOBE] maps-config failed:', err.message);
    }

    applyIonToken(config.cesiumIonToken);

    setProgress(55, 'Rendering base map network...');
    await loadOsmGlobe(viewer);

    setProgress(75, 'Enabling 3D terrain & buildings...');

    document.getElementById('toggleTraffic')?.addEventListener('change', () => {
      syncTrafficOverlay(viewer);
      viewer.scene.requestRender();
    });

    console.info('[GLOBE] Mode: OpenStreetMap + Cesium 3D terrain');
    viewer.scene.requestRender();
    return state;
  }

  window.initGoogleEarthGlobe = initGoogleEarthGlobe;
  window.setGlobeMapStyle = setGlobeMapStyle;
  window.getGlobe3DState = () => state;
  window.getBuildingsTileset = () => state.buildingsTileset;
  window.syncOsmTrafficOverlay = () => {
    if (window.viewer) syncTrafficOverlay(window.viewer);
  };
})();

