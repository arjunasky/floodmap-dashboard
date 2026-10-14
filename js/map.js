// ============================================================
// MAP.JS — Leaflet OSM Visualization
// Polyline mengikuti bentuk jalan + lebar dinamis sesuai zoom
// ============================================================

// State
let map = null;
let vehicleMarker = null;
let floodLayerGroup = null;
let roadEventLayerGroup = null;
let vehicleLayerGroup = null;
let segmentPolylines = {};      // key: segment_id, value: { layer, widthMeters, lat }
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
    MAX_GAP_BREAK:     50,
    MIN_POINTS_SEGMENT: 2
};

// 🔧 LEBAR JALAN (meter) sesuai kategori kedalaman
const ROAD_WIDTH_M = {
    aman:   4.0,    // ~2 jalur sempit
    siaga:  5.0,    // jalan sedang
    bahaya: 6.5     // jalan besar
};

// ============================================================
// UTIL — Konversi meter ke pixel di zoom tertentu
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

    // 🔧 ZOOM LISTENER — update lebar polyline tiap zoom berubah
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
// 4. ROAD MATCHING — OSRM dengan GEOMETRY
// ============================================================
const roadMatchCache = {};

async function matchToRoad(points) {
    if (points.length === 0) {
        return { matched: [], geometry: [] };
    }

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

        const url = `https://router.project-osrm.org/match/v1/driving/${coords}` +
                    `?geometries=geojson&overview=full&gaps=ignore&tidy=true&radiuses=30`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`OSRM ${res.status}`);
            const data = await res.json();

            // Extract tracepoint info (untuk match status)
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

            // 🔧 Extract geometry (koordinat mengikuti jalan)
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
// 5. BUILD SEGMENTS — dengan filter DRY_THRESHOLD
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
// 6. REDRAW MAP — Polyline mengikuti geometri jalan
// ============================================================
async function redrawMapFromData(allData, floodData, offRoadData) {
    if (!map || !floodLayerGroup) return;

    if (!floodData) floodData = [];
    if (!offRoadData) offRoadData = [];

    // 🔧 FILTER: hanya depth >= 3 cm
    const DRY = (typeof DRY_THRESHOLD !== 'undefined') ? DRY_THRESHOLD : 3.0;
    const beforeFilter = floodData.length;
    floodData = floodData.filter(p => (p.depth || 0) >= DRY);
    if (beforeFilter > floodData.length) {
        console.log(`🚫 DRY filter: ${beforeFilter - floodData.length} titik dibuang`);
    }

    floodLayerGroup.clearLayers();
    segmentPolylines = {};
    totalDistance = 0;

    // ---- RENDER POLYLINE per segment_id ----
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

                // Hitung avg depth untuk kategori
                const avgDepth = seg.reduce((s, p) => s + (p.depth || 0), 0) / seg.length;
                const category = avgDepth < 10 ? 'aman' : avgDepth < 20 ? 'siaga' : 'bahaya';
                const color = MAP_CONFIG.colors[category];
                const widthMeters = ROAD_WIDTH_M[category];

                // 🔧 ROAD MATCHING — pakai geometri jalan asli
                let path = seg.map(p => [p.latitude, p.longitude]);

                try {
                    const matchResult = await matchToRoad(seg);
                    if (matchResult.geometry && matchResult.geometry.length >= 2) {
                        path = matchResult.geometry.map(g => [g.lat, g.lng]);
                        console.log(`🛣️  Segment ${sid}: pakai geometri OSRM (${path.length} titik)`);
                    } else {
                        // Fallback: smooth path GPS raw
                        path = smoothPath(path);
                    }
                } catch (e) {
                    path = smoothPath(path);
                }

                // Hitung panjang
                let segLength = 0;
                for (let i = 1; i < path.length; i++) {
                    segLength += haversine(path[i-1][0], path[i-1][1], path[i][0], path[i][1]);
                }
                totalDistance += segLength;

                // Center lat untuk kalkulasi lebar
                const centerLat = path[Math.floor(path.length / 2)][0];

                // 🔧 HITUNG WEIGHT sesuai zoom saat ini
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
                        <strong>Segmen:</strong> ${sid}${segments.length > 1 ? ` (part ${idx+1})` : ''}<br>
                        <strong>Panjang:</strong> ${segLength.toFixed(1)} m<br>
                        <strong>Lebar visual:</strong> ${widthMeters.toFixed(1)} m<br>
                        <strong>Rata-rata depth:</strong> ${avgDepth.toFixed(1)} cm<br>
                        <strong>Titik GPS:</strong> ${seg.length}
                    </div>
                `);

                floodLayerGroup.addLayer(polyline);

                // Simpan meta untuk zoom update
                segmentPolylines[`${sid}_${idx}`] = {
                    layer: polyline,
                    widthMeters: widthMeters,
                    lat: centerLat
                };
            }
        }
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
            console.log(`📍 Auto-focus: ${last.latitude.toFixed(6)}, ${last.longitude.toFixed(6)}`);
        }
    }

    updateMapStats(floodData.length, roadEventMarkers.length, offRoadData.length);
}

// ============================================================
// 7. UPDATE WIDTH saat zoom berubah
// ============================================================
function updatePolylineWeights() {
    if (!map) return;

    const currentZoom = map.getZoom();
    let updated = 0;

    Object.values(segmentPolylines).forEach(item => {
        if (!item.layer || !item.widthMeters) return;
        const newWeight = getWeightPixels(item.lat, currentZoom, item.widthMeters);
        item.layer.setStyle({ weight: newWeight });
        updated++;
    });

    if (updated > 0) {
        console.log(`🔧 Updated ${updated} polyline weights (zoom ${currentZoom})`);
    }
}

// ============================================================
// 8. ROAD EVENTS MARKER
// ============================================================
function initRoadEventLayer(mapInstance) {
    if (!mapInstance) return;
    roadEventLayerGroup = L.layerGroup().addTo(mapInstance);
}

function renderRoadEvents(events) {
    if (!roadEventLayerGroup) return;

    roadEventLayerGroup.clearLayers();
    roadEventMarkers = [];

    if (!events || Object.keys(events).length === 0) return;

    const entries = Object.values(events).sort((a, b) => a.timestamp - b.timestamp);

    entries.forEach(ev => {
        if (ev.latitude === undefined || ev.longitude === undefined) return;

        const lat = parseFloat(ev.latitude);
        const lng = parseFloat(ev.longitude);
        if (isNaN(lat) || isNaN(lng)) return;

        const isPothole = ev.event_type === 'pothole';
        const color = isPothole ? '#dc2626' : '#f59e0b';
        const emoji = isPothole ? '🕳️' : '🚧';
        const label = isPothole ? 'Lubang' : 'Polisi Tidur';

        const icon = L.divIcon({
            className: 'road-event-marker',
            html: `<div style="
                background:${color};
                width:32px; height:32px;
                border-radius:50%;
                border:3px solid #fff;
                box-shadow:0 2px 10px rgba(0,0,0,0.35);
                display:flex; align-items:center; justify-content:center;
                font-size:16px;
            ">${emoji}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lng], { icon });

        marker.bindPopup(`
            <div style="font-family:Inter; font-size:12px; min-width:180px;">
                <strong style="color:${color}; font-size:14px;">${emoji} ${label}</strong>
                <hr style="margin:6px 0; border:none; border-top:1px solid #e2e8f0;">
                <table style="width:100%; font-size:11px;">
                    <tr><td><strong>Kekuatan:</strong></td><td>${(parseFloat(ev.magnitude_g)||0).toFixed(2)} g</td></tr>
                    <tr><td><strong>Delay 2ban:</strong></td><td>${ev.delay_ms || '-'} ms</td></tr>
                    <tr><td><strong>Waktu:</strong></td><td>${formatTime(ev.timestamp)}</td></tr>
                </table>
            </div>
        `);

        roadEventLayerGroup.addLayer(marker);
        roadEventMarkers.push({ marker, data: ev, type: ev.event_type });
    });

    console.log(`📌 ${roadEventMarkers.length} event dirender`);
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
function updateMapStats(points, events, offRoad) {
    const el1 = document.getElementById('floatPoints');
    const el2 = document.getElementById('floatEvents');
    const el3 = document.getElementById('floatOffRoad');

    if (el1) el1.textContent = points;
    if (el2) el2.textContent = events;
    if (el3) el3.textContent = offRoad || 0;
}

// ============================================================
// 10. FILTER HANDLERS
// ============================================================
function setupMapFilters() {
    const cbFlood = document.getElementById('filterFlood');
    const cbVehicle = document.getElementById('filterVehicle');

    if (cbFlood) {
        cbFlood.addEventListener('change', () => {
            if (cbFlood.checked) {
                if (floodLayerGroup) floodLayerGroup.addTo(map);
            } else {
                if (floodLayerGroup) map.removeLayer(floodLayerGroup);
            }
        });
    }

    if (cbVehicle) {
        cbVehicle.addEventListener('change', () => {
            if (cbVehicle.checked) {
                if (vehicleMarker && !map.hasLayer(vehicleMarker)) {
                    vehicleMarker.addTo(map);
                }
            } else {
                if (vehicleMarker && map.hasLayer(vehicleMarker)) {
                    map.removeLayer(vehicleMarker);
                }
            }
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

console.log('✅ map.js loaded (road-matched + zoom-adaptive width)');