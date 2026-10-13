// ============================================================
// APP.JS — Main Application Logic
// FloodMap Makassar — Sensor Fusion Dashboard
// ============================================================

const APP = {
    thresholdSiaga: 10,
    thresholdBahaya: 20,
    thresholdImu: 0.30
};

// ============================================================
// VARIABEL GLOBAL
// ============================================================
let currentAllData = [];         // 🔧 SEMUA data (sensor readout)
let currentVehicleData = [];     // Hanya GPS real (marker peta)
let currentFloodData = [];       // Genangan di jalan
let currentOffRoadData = [];     // Genangan di luar jalan
let currentEvents = {};          // Road events

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 FloodMap Makassar dimulai...');

    // Init map dulu
    initMap();

    setupNavigation();
    setupSettings();
    setupMapFilters();
    setupAdminPanel();

    // ============================================================
    // LISTENER: FLOOD POINTS
    // ============================================================
    onFloodPoints(async (data) => {
        const rawArray = Object.values(data || {});
        console.log('📦 Raw data:', rawArray.length);

        const allData = rawArray
            .map(p => ({
                latitude:   parseFloat(p.latitude),
                longitude:  parseFloat(p.longitude),
                depth:      parseFloat(p.depth) || 0,
                status:     (p.status || 'aman').toLowerCase(),
                location:   p.location || '-',
                timestamp:  p.timestamp || Date.now(),
                imuZ:       parseFloat(p.imuZ) || 0,
                imuMag:     parseFloat(p.imuMag) || 0,
                pitch:      parseFloat(p.pitch) || 0,
                roll:       parseFloat(p.roll) || 0,
                segment_id: p.segment_id || '',
                depth_valid: p.depth_valid !== false,
                source:     p.source || 'gps'
            }))
            .filter(p => !isNaN(p.latitude) && !isNaN(p.longitude))
            .sort((a, b) => a.timestamp - b.timestamp);

        // 🔧 currentAllData — SEMUA data (sensor readout, riwayat)
        currentAllData = allData;

        // 🔧 currentVehicleData — HANYA GPS real (marker di peta)
        currentVehicleData = allData.filter(p => p.source === 'gps');

        // 🔧 Genangan: hanya GPS real + depth > 0 + segment_id
        const withFlood = allData.filter(p =>
            p.source === 'gps' &&
            p.depth > 0 &&
            p.segment_id &&
            p.depth_valid !== false
        );

        // Road matching untuk filter mana yang di jalan
        if (withFlood.length > 0 && typeof matchToRoad === 'function') {
            const matched = await matchToRoad(withFlood);
            currentFloodData   = matched.filter(p => p.matched);
            currentOffRoadData = matched.filter(p => !p.matched);
        } else {
            currentFloodData = withFlood;
            currentOffRoadData = [];
        }

        console.log(`📊 Sensor: ${allData.length} | GPS: ${currentVehicleData.length} | Genangan di jalan: ${currentFloodData.length} | Off-road: ${currentOffRoadData.length}`);

        // ============================================================
        // UPDATE UI
        // ============================================================
        updateUI(currentAllData);              // Sensor readout — semua data
        updateHistoryTable(currentAllData);    // Riwayat — semua data
        updateNotif(currentAllData);
        updateCharts(currentFloodData);        // Chart — genangan di jalan
        updateOffRoadStats(currentOffRoadData);

        // Peta — hanya GPS real
        redrawMapFromData(currentVehicleData, currentFloodData, currentOffRoadData)
            .catch(err => console.error('Map error:', err));

        // Geocoding async
        if (currentVehicleData.length > 0 && typeof prefetchStreetNames === 'function') {
            prefetchStreetNames(currentVehicleData).then(() => {
                currentVehicleData.forEach(p => {
                    const name = geocodeCache[gridKey(p.latitude, p.longitude)];
                    if (name) p.location = name;
                });
                currentAllData.forEach(p => {
                    const name = geocodeCache[gridKey(p.latitude, p.longitude)];
                    if (name) p.location = name;
                });
                updateUI(currentAllData);
                updateHistoryTable(currentAllData);
            });
        }
    });

    // ============================================================
    // LISTENER: ROAD EVENTS
    // ============================================================
    onRoadEvents((data) => {
        currentEvents = data || {};
        window._roadEventsCache = currentEvents;

        if (typeof renderRoadEvents === 'function') {
            renderRoadEvents(currentEvents);
        }
        if (typeof updateEventChart === 'function') {
            updateEventChart(currentEvents);
        }
        updateEventsTable(currentEvents);
    });

    // ============================================================
    // LISTENER: SYSTEM STATUS
    // ============================================================
    onSystemStatus((status) => {
        const raw = status.esp32_online;
        const isEspOnline = raw === true || raw === 'true' || raw === 1 || raw === '1';

        const ind = document.getElementById('espIndicator');
        if (ind) {
            ind.innerHTML = isEspOnline
                ? '<i class="ti ti-circle-filled" style="color:#22c55e;"></i> ESP32 Online'
                : '<i class="ti ti-circle-filled" style="color:#ef4444;"></i> ESP32 Offline';
        }

        if (status.last_update) {
            setText('lastUpdate', 'Update: ' + formatTime(status.last_update));
        }

        updateSensorStatus({
            sensor: status.sensor_status || 'menunggu',
            imu:    status.imu_status    || 'menunggu',
            gps:    status.gps_status    || 'menunggu',
            esp:    isEspOnline ? 'online' : 'offline'
        });
    });

    // ============================================================
    // INIT ROAD EVENTS LAYER
    // ============================================================
    setTimeout(() => {
        if (typeof initRoadEventLayer === 'function') {
            initRoadEventLayer(map);
        }
        if (typeof listenRoadEvents === 'function') {
            listenRoadEvents();
        }
    }, 500);

    setupExportButtons();

    // ============================================================
    // TOMBOL FOCUS KENDARAAN
    // ============================================================
    const btnFocus = document.getElementById('btnFocusVehicle');
    if (btnFocus) {
        btnFocus.addEventListener('click', () => {
            console.log('🎯 Tombol focus. Data kendaraan:', currentVehicleData.length);

            if (!currentVehicleData || currentVehicleData.length === 0) {
                alert('Belum ada data kendaraan dari GPS. Pastikan GPS sudah fix.');
                return;
            }

            const last = currentVehicleData[currentVehicleData.length - 1];
            map.setView([last.latitude, last.longitude], 18);

            if (typeof vehicleMarker !== 'undefined' && vehicleMarker) {
                if (!map.hasLayer(vehicleMarker)) vehicleMarker.addTo(map);
                vehicleMarker.setLatLng([last.latitude, last.longitude]);
                vehicleMarker.openPopup();
            }
        });
    }
});

// ============================================================
// NAVIGATION
// ============================================================

function setupNavigation() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuToggle = document.getElementById('menuToggle');
    const sidebarClose = document.getElementById('sidebarClose');

    function openSidebar() {
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
        document.body.classList.add('sidebar-open');
    }

    function closeSidebar() {
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');
        setTimeout(() => {
            if (typeof map !== 'undefined' && map) map.invalidateSize();
        }, 350);
    }

    if (menuToggle) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar && sidebar.classList.contains('open')) closeSidebar();
            else openSidebar();
        });
    }
    if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const page = this.dataset.page;

            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));

            const target = document.getElementById('page-' + page);
            if (target) target.classList.add('active');

            const titleEl = document.getElementById('pageTitle');
            if (titleEl) titleEl.textContent = this.querySelector('span').textContent;

            closeSidebar();

            if (page === 'map' && map) {
                setTimeout(() => map.invalidateSize(), 200);
            }
            if (page === 'stats') {
                updateCharts(currentFloodData);
                if (typeof updateEventChart === 'function') {
                    updateEventChart(currentEvents);
                }
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });
}

// ============================================================
// SETTINGS
// ============================================================

function setupSettings() {
    const btn = document.getElementById('btnSaveSettings');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const s = parseInt(document.getElementById('thresholdSiaga').value);
        const b = parseInt(document.getElementById('thresholdBahaya').value);
        const imu = parseFloat(document.getElementById('thresholdImu').value);

        if (s >= b) {
            alert('⚠️ Nilai Siaga harus lebih kecil dari Bahaya!');
            return;
        }

        APP.thresholdSiaga = s;
        APP.thresholdBahaya = b;
        APP.thresholdImu = imu;

        alert('✅ Pengaturan disimpan!');
        console.log('⚙️ Settings:', APP);
    });
}

// ============================================================
// 🔒 ADMIN PANEL — HIDDEN
// Akses: Klik 5x pada header "Pengaturan Sistem" ATAU ketik "admin"
// ============================================================

let adminUnlocked = false;
let adminClickCount = 0;
let adminClickTimer = null;

function setupAdminPanel() {
    const header = document.getElementById('settingsHeader');
    const panel = document.getElementById('adminPanel');

    if (!header || !panel) {
        console.warn('⚠️ Admin panel elements tidak ditemukan');
        return;
    }

    // Metode 1: Klik 5x pada header
    header.addEventListener('click', () => {
        adminClickCount++;
        clearTimeout(adminClickTimer);
        adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 800);

        if (adminClickCount >= 5) {
            adminClickCount = 0;
            unlockAdmin();
        }
    });

    // Metode 2: Ketik "admin"
    let typedBuffer = '';
    document.addEventListener('keydown', (e) => {
        const currentPage = document.querySelector('.page-content.active');
        if (!currentPage || currentPage.id !== 'page-settings') return;

        if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
            typedBuffer += e.key.toLowerCase();
            if (typedBuffer.length > 10) typedBuffer = typedBuffer.slice(-10);

            if (typedBuffer.endsWith('admin')) {
                typedBuffer = '';
                unlockAdmin();
            }
        }
    });

    function unlockAdmin() {
        if (adminUnlocked) return;
        adminUnlocked = true;
        panel.style.display = 'block';

        if (!document.querySelector('.admin-active-indicator')) {
            const dot = document.createElement('div');
            dot.className = 'admin-active-indicator';
            document.body.appendChild(dot);
        }
        console.log('🔓 Admin panel unlocked');
    }

    function lockAdmin() {
        adminUnlocked = false;
        panel.style.display = 'none';
        const dot = document.querySelector('.admin-active-indicator');
        if (dot) dot.remove();
        console.log('🔒 Admin panel locked');
    }

    // Admin buttons
    const btnResetView = document.getElementById('btnAdminResetView');
    if (btnResetView) btnResetView.addEventListener('click', () => resetViewOnly());

    const btnClearFlood = document.getElementById('btnAdminClearFlood');
    if (btnClearFlood) {
        btnClearFlood.addEventListener('click', () => {
            if (!confirm('⚠️ Hapus SEMUA flood_points?')) return;
            if (!confirm('Yakin? Tidak bisa dikembalikan.')) return;
            clearFloodPoints().then(() => {
                alert('✅ Dihapus');
                resetViewOnly();
            });
        });
    }

    const btnClearEvents = document.getElementById('btnAdminClearEvents');
    if (btnClearEvents) {
        btnClearEvents.addEventListener('click', () => {
            if (!confirm('⚠️ Hapus SEMUA road_events?')) return;
            if (!confirm('Yakin?')) return;
            clearRoadEvents().then(() => {
                alert('✅ Dihapus');
                if (typeof roadEventLayerGroup !== 'undefined' && roadEventLayerGroup) {
                    roadEventLayerGroup.clearLayers();
                }
            });
        });
    }

    const btnFullReset = document.getElementById('btnAdminFullReset');
    if (btnFullReset) {
        btnFullReset.addEventListener('click', () => {
            if (!confirm('⚠️⚠️ FULL RESET?')) return;
            if (!confirm('Yakin?')) return;
            if (!confirm('Lanjutkan?')) return;

            Promise.all([clearFloodPoints(), clearRoadEvents()])
                .then(() => {
                    alert('✅ Full reset');
                    resetViewOnly();
                    if (typeof roadEventLayerGroup !== 'undefined' && roadEventLayerGroup) {
                        roadEventLayerGroup.clearLayers();
                    }
                });
        });
    }

    const btnLock = document.getElementById('btnAdminLock');
    if (btnLock) btnLock.addEventListener('click', () => lockAdmin());
}

// ============================================================
// RESET TAMPILAN (hanya visual)
// ============================================================

function resetViewOnly() {
    console.log('🔄 Reset tampilan saja');

    if (typeof map !== 'undefined' && map) {
        map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
    }
    if (typeof floodLayerGroup !== 'undefined' && floodLayerGroup) {
        floodLayerGroup.clearLayers();
    }
    if (typeof roadEventLayerGroup !== 'undefined' && roadEventLayerGroup) {
        roadEventLayerGroup.clearLayers();
    }
    if (typeof vehicleMarker !== 'undefined' && vehicleMarker && map) {
        vehicleMarker.setLatLng(MAP_CONFIG.center);
    }
    if (typeof segmentPolylines !== 'undefined') {
        segmentPolylines = {};
    }
    if (typeof roadEventMarkers !== 'undefined') {
        roadEventMarkers = [];
    }
    if (typeof updateMapStats === 'function') {
        updateMapStats(0, 0, 0);
    }
    if (typeof isFirstLoad !== 'undefined') {
        isFirstLoad = true;
    }

    const notif = document.getElementById('notifBox');
    if (notif) {
        notif.innerHTML = '<div class="notif-item info">Tampilan direset</div>';
    }

    console.log('✅ Tampilan reset');
}

// ============================================================
// EVENTS TABLE
// ============================================================

function updateEventsTable(events) {
    const tb = document.getElementById('eventsTableBody');
    if (!tb) return;

    const arr = Object.values(events || {});
    if (arr.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" class="empty">Belum ada event</td></tr>';
        setText('eventCount', '(0 entri)');
        return;
    }

    const sorted = arr.sort((a, b) => b.timestamp - a.timestamp);

    tb.innerHTML = sorted.map((e, i) => {
        const isPothole = e.event_type === 'pothole';
        const emoji = isPothole ? '🕳️' : '🚧';
        const label = isPothole ? 'Lubang' : 'Polisi Tidur';
        const cls = isPothole ? 'bahaya' : 'siaga';

        return `<tr>
            <td>${i+1}</td>
            <td>${formatTime(e.timestamp)}</td>
            <td><span class="status-badge ${cls}">${emoji} ${label}</span></td>
            <td>${(parseFloat(e.magnitude_g) || 0).toFixed(2)} g</td>
            <td>${(parseFloat(e.z_axis_g) || 0).toFixed(2)} g</td>
            <td style="font-size:11px;">
                ${(parseFloat(e.latitude)||0).toFixed(5)}, ${(parseFloat(e.longitude)||0).toFixed(5)}
            </td>
        </tr>`;
    }).join('');

    setText('eventCount', `(${arr.length} entri)`);
}

// ============================================================
// EXPORT BUTTONS
// ============================================================

function setupExportButtons() {
    const csv = document.getElementById('btnExportEventsCSV');
    if (csv) {
        csv.addEventListener('click', () => {
            const arr = Object.values(currentEvents);
            if (arr.length === 0) {
                alert('Tidak ada event');
                return;
            }
            const headers = ['timestamp', 'event_type', 'latitude', 'longitude', 'magnitude_g', 'z_axis_g', 'delay_ms'];
            let out = headers.join(',') + '\n';
            arr.forEach(e => {
                out += headers.map(h => `"${e[h] !== undefined ? e[h] : ''}"`).join(',') + '\n';
            });
            downloadFile(out, `road_events_${Date.now()}.csv`, 'text/csv');
        });
    }

    const json = document.getElementById('btnExportEventsJSON');
    if (json) {
        json.addEventListener('click', () => {
            downloadFile(JSON.stringify(currentEvents, null, 2),
                `road_events_${Date.now()}.json`, 'application/json');
        });
    }

    const clr = document.getElementById('btnClearEvents');
    if (clr) {
        clr.addEventListener('click', () => {
            if (!confirm('Hapus semua event?')) return;
            clearRoadEvents().then(() => alert('✅ Dihapus'));
        });
    }
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// ============================================================
// EXPORT GLOBAL
// ============================================================

window.APP = APP;
window.initMap = initMap;
window.resetViewOnly = resetViewOnly;
window.currentAllData = currentAllData;
window.currentVehicleData = currentVehicleData;
window.currentFloodData = currentFloodData;
window.currentOffRoadData = currentOffRoadData;

console.log('✅ app.js loaded');