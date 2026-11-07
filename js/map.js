// ============================================================
// MAP.JS — Leaflet OpenStreetMap
// ============================================================

let map = null;
let vehicleMarker = null;
let floodLayerGroup = null;
let roadEventLayerGroup = null;
let potholeLayerGroup = null; 
let bumpLayerGroup = null;
let vehicleLayerGroup = null;
let segmentPolylines = {};
let roadEventMarkers = [];
let totalDistance = 0;
let isFirstLoad = true;

const MAP_CONFIG = {
    center: [-5.1464, 119.4396],
    zoom: 15,
    colors: {
        aman:   '#22c55e',
        siaga:  '#f59e0b',
        bahaya: '#ef4444'
    },
    polylineOpacity: 0.85
};

const ROAD_CONFIG = {
    MAX_SNAP_DISTANCE: 30,
    MAX_GAP_BREAK:     40,
    MIN_POINTS_SEGMENT: 2
};

const ROAD_WIDTH_M = { aman: 4.0, siaga: 5.0, bahaya: 6.5 };

function metersPerPixel(lat, zoom) {
    return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
}

function getWeightPixels(lat, zoom, widthMeters) {
    const mpp = metersPerPixel(lat, zoom);
    let w = widthMeters / mpp;
    if (w < 3) w = 3;
    if (w > 50) w = 50;
    return w;
}

// ============================================================
// 🔧 SNAP TO ROAD (OSRM NEAREST) — Untuk Marker Presisi
// ============================================================
const snappedMarkerCache = {};

async function snapMarkerToRoad(lat, lng, segmentId) {
    if (snappedMarkerCache[segmentId]) return snappedMarkerCache[segmentId];
    try {
        const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`);
        if (res.ok) {
            const data = await res.json();
            if (data.waypoints && data.waypoints.length > 0) {
                const snapped = { 
                    lat: data.waypoints[0].location[1], 
                    lng: data.waypoints[0].location[0], 
                    distance: data.waypoints[0].distance 
                };
                snappedMarkerCache[segmentId] = snapped;
                return snapped;
            }
        }
    } catch (e) { 
        console.warn('Snap to road gagal:', e.message); 
    }
    const fallback = { lat: lat, lng: lng, distance: 0 };
    snappedMarkerCache[segmentId] = fallback;
    return fallback;
}

// ============================================================
// 1. INIT MAP
// ============================================================
function initMap() {
    const mapDiv = document.getElementById('map') || document.getElementById('googleMap');
    if (!mapDiv) return;

    map = L.map(mapDiv.id, {
        center: MAP_CONFIG.center,
        zoom: MAP_CONFIG.zoom,
        zoomControl: true,
        preferCanvas: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    floodLayerGroup = L.layerGroup().addTo(map);
    roadEventLayerGroup = L.layerGroup().addTo(map);
    potholeLayerGroup = L.layerGroup().addTo(map);
    bumpLayerGroup = L.layerGroup().addTo(map);
    vehicleLayerGroup = L.layerGroup().addTo(map);

    vehicleMarker = L.marker(MAP_CONFIG.center, {
        icon: L.divIcon({
            className: 'vehicle-marker',
            html: `<div style="background: #3b82f6; width: 18px; height: 18px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 12px rgba(59,130,246,0.7);"></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }),
        zIndexOffset: 1000
    });

    L.control.scale({ imperial: false, metric: true }).addTo(map);
    return map;
}

function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// ============================================================
// 6. REDRAW MAP (Marker Focus)
// ============================================================
async function redrawMapFromData(allData, floodData, offRoadData) {
    if (!map || !floodLayerGroup) return;
    if (!floodData) floodData = [];
    if (!offRoadData) offRoadData = [];

    const DRY = (typeof DRY_THRESHOLD !== 'undefined') ? DRY_THRESHOLD : 3.0;
    floodData = floodData.filter(p => (p.depth || 0) >= DRY);

    floodLayerGroup.clearLayers();
    const segmentMarkers = {};
    
    for (const p of floodData) {
        const sid = p.segment_id || 'unknown';
        if (segmentMarkers[sid]) continue;

        const segPoints = floodData.filter(x => x.segment_id === sid);
        const avgDepth = segPoints.reduce((s, x) => s + (x.depth || 0), 0) / segPoints.length;
        const maxDepth = Math.max(...segPoints.map(x => x.depth || 0));
        const cat = avgDepth < 10 ? 'aman' : avgDepth < 20 ? 'siaga' : 'bahaya';
        const color = MAP_CONFIG.colors[cat];

        const midIdx = Math.floor(segPoints.length / 2);
        const baseLat = segPoints[midIdx].latitude;
        const baseLng = segPoints[midIdx].longitude;

        const snapped = await snapMarkerToRoad(baseLat, baseLng, sid);
        const finalLat = snapped.lat; 
        const finalLng = snapped.lng; 
        const gpsError = snapped.distance;

        let lengthM = 0;
        for (let i = 1; i < segPoints.length; i++) {
            lengthM += haversine(segPoints[i-1].latitude, segPoints[i-1].longitude, segPoints[i].latitude, segPoints[i].longitude);
        }

        const icon = L.divIcon({
            className: 'custom-flood-marker',
            html: `<div class="pin pin-${cat}"><div class="pin-value">${Math.round(avgDepth)}</div><div class="pin-pulse"></div></div>`,
            iconSize: [40, 50], iconAnchor: [20, 50], popupAnchor: [0, -50]
        });

        const marker = L.marker([finalLat, finalLng], { icon });

        marker.bindPopup(`
            <div style="font-family:Inter; font-size:12px; min-width:240px;">
                <div style="background:${color}; color:white; padding:6px 10px; border-radius:6px; font-weight:bold; margin-bottom:8px; text-align:center; font-size:13px;">
                    📍 GEOTAG: ${cat.toUpperCase()}
                </div>
                <table style="width:100%; border-collapse:collapse; font-size:12px;">
                    <tr style="border-bottom:1px dashed #eee;"><td style="padding:6px 0; color:#64748b;">Koordinat Jalan</td><td style="font-weight:bold; font-family:monospace; text-align:right;">${finalLat.toFixed(6)}, ${finalLng.toFixed(6)}</td></tr>
                    <tr style="border-bottom:1px dashed #eee;"><td style="padding:6px 0; color:#64748b;">Akurasi Snap</td><td style="font-weight:bold; color:${gpsError < 10 ? '#22c55e' : '#f59e0b'}; text-align:right;">± ${gpsError.toFixed(1)} m</td></tr>
                    <tr style="border-bottom:1px dashed #eee;"><td style="padding:6px 0; color:#64748b;">Panjang Genangan</td><td style="font-weight:bold; text-align:right;">${lengthM > 0 ? lengthM.toFixed(1) + ' m' : 'Titik Tunggal'}</td></tr>
                    <tr style="border-bottom:1px dashed #eee;"><td style="padding:6px 0; color:#64748b;">Depth Rata-rata</td><td style="font-weight:bold; color:${color}; text-align:right;">${avgDepth.toFixed(1)} cm</td></tr>
                    <tr style="border-bottom:1px dashed #eee;"><td style="padding:6px 0; color:#64748b;">Depth Maksimal</td><td style="font-weight:bold; color:#ef4444; text-align:right;">${maxDepth.toFixed(1)} cm</td></tr>
                    <tr><td style="padding:6px 0; color:#64748b;">Titik Sensor</td><td style="text-align:right;">${segPoints.length} tag</td></tr>
                </table>
            </div>
        `);
        floodLayerGroup.addLayer(marker);
        segmentMarkers[sid] = marker;
    }

    if (allData && allData.length > 0) {
        const last = allData[allData.length - 1];
        if (vehicleMarker) {
            if (!map.hasLayer(vehicleMarker)) vehicleMarker.addTo(map);
            vehicleMarker.setLatLng([last.latitude, last.longitude]);
            vehicleMarker.setZIndexOffset(1000);
        }
        if (isFirstLoad) { isFirstLoad = false; map.setView([last.latitude, last.longitude], 17); }
    }
    updateMapStats(floodData.length, roadEventMarkers.length, offRoadData.length);
}

// ============================================================
// 8. ROAD EVENTS MARKER (PERBAIKAN TOTAL)
// ============================================================
function initRoadEventLayer(mapInstance) {
    if (!mapInstance) return;
    if (!roadEventLayerGroup) roadEventLayerGroup = L.layerGroup().addTo(mapInstance);
    if (!potholeLayerGroup) potholeLayerGroup = L.layerGroup().addTo(mapInstance);
    if (!bumpLayerGroup) bumpLayerGroup = L.layerGroup().addTo(mapInstance);
}

async function renderRoadEvents(events) {
    if (!roadEventLayerGroup) return;

    roadEventLayerGroup.clearLayers();
    potholeLayerGroup.clearLayers();
    bumpLayerGroup.clearLayers();
    roadEventMarkers = [];

    if (!events || Object.keys(events).length === 0) return;

    const entries = Object.entries(events).sort((a, b) => a[1].timestamp - b[1].timestamp);

    for (const [key, ev] of entries) {
        if (ev.latitude === undefined || ev.longitude === undefined) continue;

        const lat = parseFloat(ev.latitude);
        const lng = parseFloat(ev.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;

        const snapped = await snapMarkerToRoad(lat, lng, 'event_' + key);
        
        const isPothole = ev.event_type === 'pothole';
        const color = isPothole ? '#dc2626' : '#f59e0b';
        const label = isPothole ? 'Lubang' : 'Polisi Tidur';

        // 🔧 INI BAGIAN YANG MEMBUAT BENTUKNYA BERUBAH
        let icon;
        if (isPothole) {
            // Lubang: Tetap bulat merah
            icon = L.divIcon({
                className: 'custom-event-marker',
                html: `<div class="event-pin event-pothole"><i class="ti ti-alert-octagon"></i></div>`,
                iconSize: [36, 36], 
                iconAnchor: [18, 18], 
                popupAnchor: [0, -18]
            });
        } else {
            // Polisi Tidur: Persegi panjang melintang (bar)
            icon = L.divIcon({
                className: 'custom-bump-marker',
                html: `<div class="event-bump-bar"></div>`,
                iconSize: [60, 16], 
                iconAnchor: [30, 8], 
                popupAnchor: [0, -8]
            });
        }

        const marker = L.marker([snapped.lat, snapped.lng], { icon });

        marker.bindPopup(`
            <div style="font-family:Inter; font-size:12px; min-width:180px;">
                <strong style="color:${color}; font-size:14px;">${label}</strong>
                <hr style="margin:6px 0; border:none; border-top:1px solid #e2e8f0;">
                <table style="width:100%; font-size:11px;">
                    <tr><td><strong>Kekuatan:</strong></td><td>${(parseFloat(ev.magnitude_g)||0).toFixed(2)} g</td></tr>
                    <tr><td><strong>Delay 2ban:</strong></td><td>${ev.delay_ms || '-'} ms</td></tr>
                    <tr><td><strong>Waktu:</strong></td><td>${formatTime(ev.timestamp)}</td></tr>
                </table>
            </div>
        `);

        if (isPothole) {
            potholeLayerGroup.addLayer(marker);
        } else {
            bumpLayerGroup.addLayer(marker);
        }
        
        roadEventLayerGroup.addLayer(marker);
        roadEventMarkers.push({ marker, data: ev, type: ev.event_type });
    }
}

function listenRoadEvents() {
    if (typeof db === 'undefined') return;
    db.ref('road_events').on('value', (snap) => {
        const data = snap.val() || {};
        renderRoadEvents(data);
    });
}

function updateMapStats(points, events, offRoad) {
    const el1 = document.getElementById('floatPoints');
    const el2 = document.getElementById('floatEvents');
    if (el1) el1.textContent = points;
    if (el2) el2.textContent = events;
}

// ============================================================
// 10. FILTER HANDLERS
// ============================================================
function setupMapFilters() {
    const cbFlood = document.getElementById('filterFlood');
    const cbVehicle = document.getElementById('filterVehicle');
    const cbPothole = document.getElementById('filterPothole');
    const cbBump = document.getElementById('filterBump');

    if (cbFlood) {
        cbFlood.addEventListener('change', () => {
            if (cbFlood.checked) { if (floodLayerGroup) floodLayerGroup.addTo(map); }
            else { if (floodLayerGroup) map.removeLayer(floodLayerGroup); }
        });
    }

    if (cbVehicle) {
        cbVehicle.addEventListener('change', () => {
            if (cbVehicle.checked) { if (vehicleMarker && !map.hasLayer(vehicleMarker)) vehicleMarker.addTo(map); }
            else { if (vehicleMarker && map.hasLayer(vehicleMarker)) map.removeLayer(vehicleMarker); }
        });
    }

    if (cbPothole) {
        cbPothole.addEventListener('change', () => {
            if (cbPothole.checked) { if (potholeLayerGroup) potholeLayerGroup.addTo(map); }
            else { if (potholeLayerGroup) map.removeLayer(potholeLayerGroup); }
        });
    }

    if (cbBump) {
        cbBump.addEventListener('change', () => {
            if (cbBump.checked) { if (bumpLayerGroup) bumpLayerGroup.addTo(map); }
            else { if (bumpLayerGroup) map.removeLayer(bumpLayerGroup); }
        });
    }

    const btnFit = document.getElementById('btnFitBounds');
    if (btnFit) {
        btnFit.addEventListener('click', () => {
            if (!map) return; const layers = [];
            if (floodLayerGroup) layers.push(...floodLayerGroup.getLayers());
            if (roadEventLayerGroup) layers.push(...roadEventLayerGroup.getLayers());
            if (layers.length === 0) return;
            map.fitBounds(L.featureGroup(layers).getBounds().pad(0.15));
        });
    }

    const btnReset = document.getElementById('btnClearView');
    if (btnReset) {
        btnReset.addEventListener('click', () => { if (map) map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom); });
    }
}

console.log('✅ map.js loaded');