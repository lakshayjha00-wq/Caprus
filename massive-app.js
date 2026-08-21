// ─── Initialize High-Performance Cesium Viewer ───
const viewer = new Cesium.Viewer('cesiumContainer', {
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
  shouldAnimate: false, 
  requestRenderMode: true, // Huge performance boost
  maximumRenderTimeChange: Infinity,
  msaaSamples: 1 // No antialiasing needed for dots
});

// Drop globe detail slightly to save memory for 14,000 points
viewer.scene.globe.maximumScreenSpaceError = 3; 

// The ONE structure capable of rendering 14k+ points fast
const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
points.blendOption = Cesium.BlendOption.OPAQUE; // Faster rendering

let satrecs = [];
let pointPrimitives = [];

// Fetch data from our dedicated massive tracker backend
async function loadMassiveCatalog() {
  try {
    const res = await fetch('http://localhost:3001/api/massive-tle');
    if (!res.ok) throw new Error("Backend not responding");
    
    const data = await res.json();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('statCount').innerText = data.count.toLocaleString();
    
    processSatellites(data.satellites);
  } catch(err) {
    console.error("Failed to load catalog:", err);
    document.getElementById('loading').innerText = "❌ ERROR: Cannot connect to backend server. Is it running on port 3030?";
  }
}

function processSatellites(satellites) {
  console.log(`Processing ${satellites.length} TLEs into SGP4 records...`);
  
  // Base color for the massive swarm (sky blue)
  const baseColor = Cesium.Color.fromCssColorString('#38bdf8');

  // Pre-parse TLEs into satrec objects (takes ~100ms)
  for (let i = 0; i < satellites.length; i++) {
    const s = satellites[i];
    try {
      const satrec = satellite.twoline2satrec(s.tle1, s.tle2);
      if (satrec) {
        satrecs.push(satrec);
        
        // Add a dummy point initially at 0,0
        const p = points.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          pixelSize: 2, // Tiny dot
          color: baseColor,
        });
        pointPrimitives.push(p);
      }
    } catch(e) {
      // ignore invalid TLEs
    }
  }
  
  console.log(`Successfully parsed ${satrecs.length} valid orbits.`);
  
  // Run first propagation
  propagatePositions();
  
  // Re-propagate the entire 14k swarm every 2 seconds
  // (Doing this 60 times a second would fry the CPU, 2 seconds is smooth enough for scale)
  setInterval(propagatePositions, 2000);
}

function propagatePositions() {
  const now = new Date();
  
  for (let i = 0; i < satrecs.length; i++) {
    const satrec = satrecs[i];
    const point = pointPrimitives[i];
    
    // Propagate position using SGP4 library
    const positionAndVelocity = satellite.propagate(satrec, now);
    
    if (positionAndVelocity.position && typeof positionAndVelocity.position !== 'boolean') {
      const p = positionAndVelocity.position;
      
      // satellite.js returns positions in kilometers (ECI coordinate system)
      // We must convert ECI to ECF (Earth-Centered, Earth-Fixed) 
      const gmst = satellite.gstime(now);
      const positionGd = satellite.eciToGeodetic(p, gmst);
      
      const lon = satellite.degreesLong(positionGd.longitude);
      const lat = satellite.degreesLat(positionGd.latitude);
      const altMeters = positionGd.height * 1000;
      
      // Filter anomalies (re-entering satellites going negative altitude)
      if (altMeters > 0) {
        point.position = Cesium.Cartesian3.fromDegrees(lon, lat, altMeters);
        point.show = true;
      } else {
        point.show = false;
      }
    } else {
      point.show = false; // Cannot compute (decayed or bad TLE)
    }
  }
  
  // Ask Cesium to redraw the screen with the new positions
  viewer.scene.requestRender();
}

// Start sequence
loadMassiveCatalog();
