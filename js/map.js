// ============================================================
// MAP.JS — Leaflet OpenStreetMap Visualization
// Polyline genangan + Marker event jalan
// ============================================================

// State
let map = null;
let vehicleMarker = null;
let floodLayerGroup = null;
let roadEventLayerGroup = null;
let vehicleLayerGroup = null;
let segmentPolylines = {};
let roadEventMarkers = [];
let totalDistance = 0;

const MAP_CONFIG = {
    center: [-5.1464, 119.4396],
    zoom: 15,
    colors: {
        aman:   '#22c55e',   // hijau
        siaga:  '#f59e0b',   // kuning
        bahaya: '#ef4444'    // merah
    },
    polylineWeight: 6,
    polylineOpacity: 0.85
};

// ============================================================
// 1. INISIALISASI PETA
// ============================================================

function initMap() {
    console.log('🗺️ Init Leaflet + OpenStreetMap...');

    map = L.map('map', {
        center: MAP_CONFIG.center,
        zoom: MAP_CONFIG.zoom,
        zoomControl: true,
        preferCanvas: true
    });

    // Tile layer OSM
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Layer groups
    floodLayerGroup = L.layerGroup().addTo(map);
    roadEventLayerGroup = L.layerGroup().addTo(map);
    vehicleLayerGroup = L.layerGroup().addTo(map);

    // Vehicle marker
    vehicleMarker = L.marker(MAP_CONFIG.center, {
        icon: L.divIcon({
            className: 'vehicle-marker',
            html: `<div style="
                background: #3b82f6;
                width: 18px; height: 18px;
                border-radius: 50%;
                border: 3px solid #fff;
                box-shadow: 0 0 12px rgba(59,130,246,0.7);
                animation: pulse 1.5s infinite;
            "></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }),
        zIndexOffset: 1000
    });

    // Scale bar
    L.control.scale({ imperial: false, metric: true }).addTo(map);

    console.log('✅ Map ready');
    return map;
}

// ============================================================
// 2. HITUNG JARAK (Haversine)
// ============================================================

function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng / 2) ** 2;
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
// MAP MATCHING — Snap polyline ke jalan OSM via OSRM
// ============================================================
async function snapToRoad(points) {
    if (points.length < 2) return points;

    // Batasi 90 titik per request (OSRM limit ~100)
    const limited = points.slice(-90);
    const coords = limited.map(p => `${p.longitude},${p.latitude}`).join(';');

    const url = `https://router.project-osrm.org/match/v1/driving/${coords}` +
                `?geometries=geojson&overview=full&gaps=ignore&tidy=true`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('OSRM error');
        const data = await res.json();

        if (data.matchings && data.matchings.length > 0) {
            // Ambil koordinat hasil matching (sudah di-snap ke jalan)
            const matchedCoords = data.matchings[0].geometry.coordinates;
            return matchedCoords.map(c => ({ latitude: c[1], longitude: c[0] }));
        }
    } catch (e) {
        console.warn('⚠️ OSRM gagal, fallback ke raw:', e.message);
    }

    // Fallback: pakai raw points
    return limited;
}

// ============================================================
// 4. RENDER POLYLINE GENANGAN
// ============================================================

// ============================================================
// RENDER POLYLINE + MARKER KENDARAAN
// ============================================================

let isFirstLoad = true;

function redrawMapFromData(allData, floodData) {
    if (!map || !floodLayerGroup) return;

    // Kalau floodData tidak dikirim, kosongkan polyline
    if (!floodData) floodData = [];

    // Clear layer polyline
    floodLayerGroup.clearLayers();
    segmentPolylines = {};
    totalDistance = 0;

    // ---- RENDER POLYLINE (dari floodData) ----
    if (floodData.length > 0) {
        const segments = {};
        floodData.forEach(p => {
            if (!p.segment_id) return;
            if (!segments[p.segment_id]) segments[p.segment_id] = [];
            segments[p.segment_id].push(p);
        });

        Object.entries(segments).forEach(([sid, points]) => {
            points.sort((a, b) => a.timestamp - b.timestamp);
            if (points.length < 2) return;

            const avgDepth = points.reduce((s, p) => s + (p.depth || 0), 0) / points.length;
            const category = avgDepth < 10 ? 'aman' : avgDepth < 20 ? 'siaga' : 'bahaya';
            const color = MAP_CONFIG.colors[category];

            const rawPath = points.map(p => [p.latitude, p.longitude]);
            const path = smoothPath(rawPath);

            let segLength = 0;
            for (let i = 1; i < path.length; i++) {
                segLength += haversine(path[i-1][0], path[i-1][1], path[i][0], path[i][1]);
            }
            totalDistance += segLength;

            const polyline = L.polyline(path, {
                color: color,
                weight: MAP_CONFIG.polylineWeight,
                opacity: MAP_CONFIG.polylineOpacity,
                lineJoin: 'round',
                lineCap: 'round'
            });

            polyline.bindPopup(`
                <div style="font-family:Inter; font-size:12px; min-width:180px;">
                    <strong style="color:${color}; font-size:13px;">● ${category.toUpperCase()}</strong><br>
                    <strong>Segmen:</strong> ${sid}<br>
                    <strong>Panjang:</strong> ${segLength.toFixed(1)} m<br>
                    <strong>Rata-rata depth:</strong> ${avgDepth.toFixed(1)} cm
                </div>
            `);

            floodLayerGroup.addLayer(polyline);
            segmentPolylines[sid] = polyline;
        });
    }

    // ---- RENDER VEHICLE MARKER (dari allData) ----
    if (allData && allData.length > 0) {
        const last = allData[allData.length - 1];

        if (vehicleMarker) {
            if (!map.hasLayer(vehicleMarker)) {
                vehicleMarker.addTo(map);
            }
            vehicleMarker.setLatLng([last.latitude, last.longitude]);
            vehicleMarker.setZIndexOffset(1000);
        }

        // Auto-focus saat pertama load
        if (isFirstLoad) {
            isFirstLoad = false;
            map.setView([last.latitude, last.longitude], 17);
            console.log(`📍 Auto-focus: ${last.latitude.toFixed(6)}, ${last.longitude.toFixed(6)}`);
        }
    }

    updateMapStats(allData ? allData.length : 0, roadEventMarkers.length);
}

// ============================================================
// 5. RENDER ROAD EVENTS (MARKER LUBANG & POLISI TIDUR)
// ============================================================

function initRoadEventLayer(mapInstance) {
    if (!mapInstance) return;
    roadEventLayerGroup = L.layerGroup().addTo(mapInstance);
}

function renderRoadEvents(events) {
    if (!roadEventLayerGroup) return;

    roadEventLayerGroup.clearLayers();
    roadEventMarkers = [];

    if (!events || Object.keys(events).length === 0) {
        updateMapStats(0, 0);
        return;
    }

    const entries = Object.values(events).sort((a, b) => a.timestamp - b.timestamp);

    entries.forEach(ev => {
        if (ev.latitude === undefined || ev.longitude === undefined) return;

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
                cursor:pointer;
                transition:transform 0.15s;
            ">${emoji}</div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([ev.latitude, ev.longitude], { icon });

        marker.bindPopup(`
            <div style="font-family:Inter, sans-serif; font-size:12px; min-width:180px;">
                <strong style="color:${color}; font-size:14px;">${emoji} ${label}</strong>
                <hr style="margin:6px 0; border:none; border-top:1px solid #e2e8f0;">
                <table style="width:100%; font-size:11px;">
                    <tr><td><strong>Kekuatan:</strong></td><td>${(ev.magnitude_g || 0).toFixed(2)} g</td></tr>
                    <tr><td><strong>Z-axis:</strong></td><td>${(ev.z_axis_g || 0).toFixed(2)} g</td></tr>
                    <tr><td><strong>Waktu:</strong></td><td>${new Date(ev.timestamp).toLocaleString('id-ID')}</td></tr>
                    <tr><td><strong>Koordinat:</strong></td><td>${ev.latitude.toFixed(6)},<br>${ev.longitude.toFixed(6)}</td></tr>
                </table>
            </div>
        `);

        // Add to appropriate group based on filter
        const filterId = isPothole ? 'filterPothole' : 'filterBump';
        const checkbox = document.getElementById(filterId);
        if (!checkbox || checkbox.checked) {
            roadEventLayerGroup.addLayer(marker);
        }

        roadEventMarkers.push({
            marker: marker,
            data: ev,
            type: ev.event_type
        });
    });

    updateMapStats(0, roadEventMarkers.length);
    console.log(`📌 ${roadEventMarkers.length} event jalan dirender`);
}

// ============================================================
// 6. LISTENER FIREBASE — ROAD EVENTS
// ============================================================

function listenRoadEvents() {
    if (typeof db === 'undefined') {
        console.warn('⚠️ Firebase db belum siap');
        return;
    }
    db.ref('road_events').on('value', (snap) => {
        const data = snap.val() || {};
        renderRoadEvents(data);
    });
}

// ============================================================
// 7. MAP STATS (Floating Info)
// ============================================================

function updateMapStats(points, events) {
    const el1 = document.getElementById('floatPoints');
    const el2 = document.getElementById('floatEvents');
    if (el1) el1.textContent = points;
    if (el2) el2.textContent = events;
}

// ============================================================
// 8. FILTER HANDLERS
// ============================================================

function setupMapFilters(currentFlood, currentEvents) {
    const cbFlood = document.getElementById('filterFlood');
    const cbVehicle = document.getElementById('filterVehicle');
    const cbPothole = document.getElementById('filterPothole');
    const cbBump = document.getElementById('filterBump');

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

    if (cbPothole && cbBump) {
        const handler = () => {
            renderRoadEvents(window._roadEventsCache || {});
        };
        cbPothole.addEventListener('change', handler);
        cbBump.addEventListener('change', handler);
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