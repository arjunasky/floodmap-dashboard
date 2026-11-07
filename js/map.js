// ============================================================
// MAP.JS — Leaflet OpenStreetMap
// Polyline mengikuti jalan + lebar dinamis + 1 marker per segment
// ============================================================

let map = null;
let vehicleMarker = null;
let floodLayerGroup = null;
let roadEventLayerGroup = null;
let potholeLayerGroup = null; // 🔧 Tambahan untuk filter
let bumpLayerGroup = null;    // 🔧 Tambahan untuk filter
let vehicleLayerGroup = null;
let segmentPolylines = {};
let roadEventMarkers = [];
let totalDistance = 0;
let isFirstLoad = true;

// 🔧 Variabel untuk Counter & Jejak Motor
window.globalVehicleTracks = []; // Menyimpan jejak GPS motor
let globalFloodCount = 0;
let globalEventCount = 0;
let globalOffRoadCount = 0;

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

const ROAD_WIDTH_M = {
    aman:   4.0,
    siaga:  5.0,
    bahaya: 6.5
};

// ============================================================
// UTIL — meter to pixel
// ============================================================
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

// 🔧 Rumus Bearing: Menghitung sudut arah jalan (0 = Utara, 90 = Timur)
function calculateBearing(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const dLng = toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 🔧 Snap marker ke jalan terdekat
const snappedMarkerCache = {};
async function snapMarkerToRoad(lat, lng, segmentId) {
    if (snappedMarkerCache[segmentId]) return snappedMarkerCache[segmentId];
    try {
        const res = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}?number=1`);
        if (res.ok) {
            const data = await res.json();
            if (data.waypoints && data.waypoints.length > 0) {
                const snapped = { lat: data.waypoints[0].location[1], lng: data.waypoints[0].location[0], distance: data.waypoints[0].distance };
                snappedMarkerCache[segmentId] = snapped;
                return snapped;
            }
        }
    } catch (e) { console.warn('Snap gagal:', e.message); }
    return { lat: lat, lng: lng, distance: 0 };
}

// ============================================================
// 1. INIT MAP
// ============================================================
function initMap() {
    console.log('🗺️ Init Leaflet + OSM');

    const mapDiv = document.getElementById('map') || document.getElementById('googleMap');
    if (!mapDiv) {
        console.error('❌ Div map tidak ditemukan!');
        return;
    }

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
    potholeLayerGroup = L.layerGroup().addTo(map); // 🔧
    bumpLayerGroup = L.layerGroup().addTo(map);    // 🔧
    vehicleLayerGroup = L.layerGroup().addTo(map);

    vehicleMarker = L.marker(MAP_CONFIG.center, {
        icon: L.divIcon({
            className: 'vehicle-marker',
            html: `<div style="
                background: #3b82f6;
                width: 18px; height: 18px;
                border-radius: 50%;
                border: 3px solid #fff;
                box-shadow: 0 0 12px rgba(59,130,246,0.7);
            "></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }),
        zIndexOffset: 1000
    });

    L.control.scale({ imperial: false, metric: true }).addTo(map);

    map.on('zoomend', () => {
        updatePolylineWeights();
    });

    console.log('✅ Map ready');
    return map;
}

// ============================================================
// 2. HAVERSINE
// ============================================================
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// ============================================================
// 3. SMOOTH PATH
// ============================================================
function smoothPath(points) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i - 1];
        const c = points[i];
        const n = points[i + 1];
        out.push([
            (p[0] + c[0] * 2 + n[0]) / 4,
            (p[1] + c[1] * 2 + n[1]) / 4
        ]);
    }
    out.push(points[points.length - 1]);
    return out;
}

// ============================================================
// 4. ROAD MATCHING — OSRM
// ============================================================
const roadMatchCache = {};

async function matchToRoad(points) {
    if (points.length === 0) return { matched: [], geometry: [] };

    const batches = [];
    for (let i = 0; i < points.length; i += 90) {
        batches.push(points.slice(i, i + 90));
    }

    const allMatched = [];
    const allGeometry = [];

    for (const batch of batches) {
        const cacheKey = batch.map(p =>
            `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`
        ).join('|');

        if (roadMatchCache[cacheKey]) {
            allMatched.push(...roadMatchCache[cacheKey].matched);
            allGeometry.push(...roadMatchCache[cacheKey].geometry);
            continue;
        }

        const coords = batch.map(p =>
            `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`
        ).join(';');

        // 🔧 Perbaikan: radiuses harus dinamis
        const radiuses = new Array(batch.length).fill(50).join(';');

        const url = `https://router.project-osrm.org/match/v1/driving/${coords}` +
                    `?geometries=geojson&overview=full&gaps=ignore&tidy=true&radiuses=${radiuses}`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`OSRM ${res.status}`);
            const data = await res.json();

            const tracepoints = data.tracepoints || [];
            const matched = [];

            batch.forEach((p, idx) => {
                const tp = tracepoints[idx];
                const snapDist = tp ? tp.distance : 999;
                matched.push({
                    ...p,
                    snapDistance: snapDist,
                    matched: snapDist <= ROAD_CONFIG.MAX_SNAP_DISTANCE
                });
            });

            const geometry = [];
            if (data.matchings && data.matchings.length > 0) {
                data.matchings.forEach(m => {
                    if (m.geometry && m.geometry.coordinates) {
                        m.geometry.coordinates.forEach(c => {
                            geometry.push({ lat: c[1], lng: c[0] });
                        });
                    }
                });
            }

            roadMatchCache[cacheKey] = { matched, geometry };
            allMatched.push(...matched);
            allGeometry.push(...geometry);

        } catch (e) {
            console.warn('⚠️ OSRM error:', e.message);
            batch.forEach(p => allMatched.push({ ...p, matched: true }));
        }
    }

    return { matched: allMatched, geometry: allGeometry };
}

// ============================================================
// 5. BUILD SEGMENTS
// ============================================================
function buildPolylineSegments(points) {
    if (points.length < 2) return [];

    const DRY = (typeof DRY_THRESHOLD !== 'undefined') ? DRY_THRESHOLD : 3.0;
    points = points.filter(p => (p.depth || 0) >= DRY);

    if (points.length < 2) return [];

    const segments = [];
    let current = [points[0]];

    for (let i = 1; i < points.length; i++) {
        const dist = haversine(
            points[i-1].latitude, points[i-1].longitude,
            points[i].latitude, points[i].longitude
        );

        if (dist > ROAD_CONFIG.MAX_GAP_BREAK) {
            if (current.length >= ROAD_CONFIG.MIN_POINTS_SEGMENT) {
                segments.push(current);
            }
            current = [points[i]];
        } else {
            current.push(points[i]);
        }
    }

    if (current.length >= ROAD_CONFIG.MIN_POINTS_SEGMENT) {
        segments.push(current);
    }

    return segments;
}

// ============================================================
// 6. REDRAW MAP (Genangan)
// ============================================================
async function redrawMapFromData(allData, floodData, offRoadData) {
    if (!map || !floodLayerGroup) return;

    if (!floodData) floodData = [];
    if (!offRoadData) offRoadData = [];

    // 🔧 Simpan jejak motor
    if (allData && allData.length > 0) {
        window.globalVehicleTracks = allData.filter(p => p.source === 'gps').sort((a, b) => a.timestamp - b.timestamp);
    }

    const DRY = (typeof DRY_THRESHOLD !== 'undefined') ? DRY_THRESHOLD : 3.0;
    floodData = floodData.filter(p => (p.depth || 0) >= DRY);

    floodLayerGroup.clearLayers();
    segmentPolylines = {};
    totalDistance = 0;

    // ---- RENDER POLYLINE (DINONAKTIFKAN AGAR FOKUS KE MARKER) ----
    /*
    if (floodData.length >= 2) {
        const groupBySeg = {};
        floodData.forEach(p => {
            if (!p.segment_id) return;
            if (!groupBySeg[p.segment_id]) groupBySeg[p.segment_id] = [];
            groupBySeg[p.segment_id].push(p);
        });

        for (const [sid, points] of Object.entries(groupBySeg)) {
            points.sort((a, b) => a.timestamp - b.timestamp);
            const segments = buildPolylineSegments(points);

            for (let idx = 0; idx < segments.length; idx++) {
                const seg = segments[idx];
                if (seg.length < 2) continue;

                const avgDepth = seg.reduce((s, p) => s + (p.depth || 0), 0) / seg.length;
                const category = avgDepth < 10 ? 'aman' : avgDepth < 20 ? 'siaga' : 'bahaya';
                const color = MAP_CONFIG.colors[category];
                const widthMeters = ROAD_WIDTH_M[category];

                let path = seg.map(p => [p.latitude, p.longitude]);

                try {
                    const matchResult = await matchToRoad(seg);
                    if (matchResult.geometry && matchResult.geometry.length >= 2) {
                        path = matchResult.geometry.map(g => [g.lat, g.lng]);
                    } else {
                        path = smoothPath(path);
                    }
                } catch (e) {
                    path = smoothPath(path);
                }

                let segLength = 0;
                for (let i = 1; i < path.length; i++) {
                    segLength += haversine(path[i-1][0], path[i-1][1], path[i][0], path[i][1]);
                }
                totalDistance += segLength;

                const centerLat = path[Math.floor(path.length / 2)][0];
                const currentZoom = map.getZoom();
                const weight = getWeightPixels(centerLat, currentZoom, widthMeters);

                const polyline = L.polyline(path, {
                    color: color,
                    weight: weight,
                    opacity: MAP_CONFIG.polylineOpacity,
                    lineJoin: 'round',
                    lineCap: 'round',
                    smoothFactor: 0.5
                });

                polyline.bindPopup(`
                    <div style="font-family:Inter; font-size:12px; min-width:180px;">
                        <strong style="color:${color}; font-size:13px;">● ${category.toUpperCase()}</strong><br>
                        <strong>Segmen:</strong> ${sid}<br>
                        <strong>Panjang:</strong> ${segLength.toFixed(1)} m<br>
                        <strong>Depth rata:</strong> ${avgDepth.toFixed(1)} cm<br>
                        <strong>Titik GPS:</strong> ${seg.length}
                    </div>
                `);

                floodLayerGroup.addLayer(polyline);
                segmentPolylines[`${sid}_${idx}`] = {
                    layer: polyline,
                    widthMeters: widthMeters,
                    lat: centerLat
                };
            }
        }
    }
    */

    // ---- MARKER PER SEGMENT (PIN TETESAN AIR) ----
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
        const finalLat = snapped.lat; const finalLng = snapped.lng; const gpsError = snapped.distance;

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
                </table>
            </div>
        `);

        floodLayerGroup.addLayer(marker);
        segmentMarkers[sid] = marker;
    }

    // ---- VEHICLE MARKER ----
    if (allData && allData.length > 0) {
        const last = allData[allData.length - 1];
        if (vehicleMarker) {
            if (!map.hasLayer(vehicleMarker)) vehicleMarker.addTo(map);
            vehicleMarker.setLatLng([last.latitude, last.longitude]);
            vehicleMarker.setZIndexOffset(1000);
        }
        if (isFirstLoad) {
            isFirstLoad = false;
            map.setView([last.latitude, last.longitude], 17);
        }
    }

    globalFloodCount = floodData.length;
    globalOffRoadCount = offRoadData.length;
    updateMapStats();
}

// ============================================================
// 7. UPDATE WIDTH saat zoom
// ============================================================
function updatePolylineWeights() {
    if (!map) return;
    const currentZoom = map.getZoom();
    Object.values(segmentPolylines).forEach(item => {
        if (!item.layer || !item.widthMeters) return;
        const newWeight = getWeightPixels(item.lat, currentZoom, item.widthMeters);
        item.layer.setStyle({ weight: newWeight });
    });
}

// ============================================================
// 8. ROAD EVENTS MARKER (BULAT: MERAH & UNGU)
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

    if (!events || Object.keys(events).length === 0) {
        globalEventCount = 0;
        updateMapStats();
        return;
    }

    const sortedEvents = Object.entries(events).sort((a, b) => a[1].timestamp - b[1].timestamp);
    const placedEvents = []; 

    for (let i = 0; i < sortedEvents.length; i++) {
        const [key, ev] = sortedEvents[i];
        if (ev.latitude === undefined || ev.longitude === undefined) continue;

        const lat = parseFloat(ev.latitude);
        const lng = parseFloat(ev.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;

        // 🔧 1. ANTI-MULTIPLY (Jarak < 20 meter diabaikan)
        let isDuplicate = false;
        for (const placed of placedEvents) {
            if (haversine(lat, lng, placed.lat, placed.lng) < 20.0) {
                isDuplicate = true; 
                break; 
            }
        }
        if (isDuplicate) continue; 
        placedEvents.push({ lat, lng });

        const snapped = await snapMarkerToRoad(lat, lng, 'event_' + key);
        const isPothole = ev.event_type === 'pothole';
        
        // 🔧 WARNA: MERAH (Lubang) vs UNGU (Polisi Tidur)
        const color = isPothole ? '#dc2626' : '#8b5cf6'; 
        const label = isPothole ? 'Lubang' : 'Polisi Tidur';

        let icon;
        if (isPothole) {
            icon = L.divIcon({
                className: 'custom-event-marker',
                html: `<div class="event-pin event-pothole"><i class="ti ti-alert-octagon"></i></div>`,
                iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18]
            });
        } else {
            // 🔧 Polisi Tidur: Marker Bulat Ungu dengan ikon garis melintang
            icon = L.divIcon({
                className: 'custom-event-marker',
                html: `<div class="event-pin event-bump"><i class="ti ti-arrows-horizontal"></i></div>`,
                iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18]
            });
        }

        const marker = L.marker([snapped.lat, snapped.lng], { icon });
        marker.bindPopup(`
            <div style="font-family:Inter; font-size:12px; min-width:180px;">
                <strong style="color:${color}; font-size:14px;">${label}</strong>
                <hr style="margin:6px 0; border:none; border-top:1px solid #e2e8f0;">
                <table style="width:100%; font-size:11px;">
                    <tr><td><strong>Kekuatan:</strong></td><td>${(parseFloat(ev.magnitude_g)||0).toFixed(2)} g</td></tr>
                    <tr><td><strong>Waktu:</strong></td><td>${formatTime(ev.timestamp)}</td></tr>
                </table>
            </div>
        `);

        if (isPothole) potholeLayerGroup.addLayer(marker);
        else bumpLayerGroup.addLayer(marker);

        roadEventLayerGroup.addLayer(marker);
        roadEventMarkers.push({ marker, data: ev, type: ev.event_type });
    }

    globalEventCount = roadEventMarkers.length;
    updateMapStats();
}

function listenRoadEvents() {
    if (typeof db === 'undefined') return;
    db.ref('road_events').on('value', (snap) => {
        const data = snap.val() || {};
        renderRoadEvents(data);
    });
}

// ============================================================
// 9. MAP STATS
// ============================================================
function updateMapStats() {
    const el1 = document.getElementById('floatPoints');
    const el2 = document.getElementById('floatEvents');
    const el3 = document.getElementById('floatOffRoad');

    if (el1) el1.textContent = globalFloodCount;
    if (el2) el2.textContent = globalEventCount;
    if (el3) el3.textContent = globalOffRoadCount || 0;
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
            if (!map) return;
            const layers = [];
            if (floodLayerGroup) layers.push(...floodLayerGroup.getLayers());
            if (roadEventLayerGroup) layers.push(...roadEventLayerGroup.getLayers());
            if (layers.length === 0) return;
            const group = L.featureGroup(layers);
            map.fitBounds(group.getBounds().pad(0.15));
        });
    }

    const btnReset = document.getElementById('btnClearView');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (!map) return;
            map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
        });
    }
}

console.log('✅ map.js loaded');