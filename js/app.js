// ============================================================
// APP.JS — Main Application Logic
// FloodMap Makassar — Sensor Fusion Dashboard
// ============================================================

const APP = {
    thresholdSiaga: 10,
    thresholdBahaya: 20,
    thresholdImu: 0.30
};

let currentDataArray = [];
let currentEvents = {};

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
    setupAdminPanel();      // 🔒 Admin panel tersembunyi

    // ---- Listener: flood points ----
    onFloodPoints((data) => {
        currentDataArray = Object.values(data)
            .filter(p => p.depth > 0 && p.segment_id)
            .filter(p => p.depth_valid !== false)
            .map(p => ({
                latitude:   parseFloat(p.latitude  || p.lat) || 0,
                longitude:  parseFloat(p.longitude || p.lng) || 0,
                depth:      parseFloat(p.depth) || 0,
                status:     (p.status || 'aman').toLowerCase(),
                location:   p.location || '-',
                timestamp:  p.timestamp || Date.now(),
                imuZ:       parseFloat(p.imuZ) || 0,
                segment_id: p.segment_id,
                source:     p.source || 'gps'
            }))
            .filter(p => p.latitude && p.longitude)
            .sort((a, b) => a.timestamp - b.timestamp);

        updateUI(currentDataArray);
        updateHistoryTable(currentDataArray);
        updateNotif(currentDataArray);
        updateCharts(currentDataArray);
        redrawMapFromData(currentDataArray);
    });

    // ---- Listener: road events ----
    onRoadEvents((data) => {
        currentEvents = data || {};
        window._roadEventsCache = currentEvents;
        renderRoadEvents(currentEvents);
        updateEventChart(currentEvents);
        updateEventsTable(currentEvents);
    });

    // ---- Listener: system status ----
    onSystemStatus((status) => {
        const ind = document.getElementById('espIndicator');
        if (ind) {
            ind.innerHTML = status.esp32_online
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
            esp:    status.esp32_online ? 'online' : 'offline'
        });
    });

    // ---- Init road events layer setelah map siap ----
    setTimeout(() => {
        initRoadEventLayer(map);
        listenRoadEvents();
    }, 500);

    setupExportButtons();
});

// ============================================================
// NAVIGATION
// ============================================================

function setupNavigation() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuToggle = document.getElementById('menuToggle');
    const sidebarClose = document.getElementById('sidebarClose');

    // ---- Fungsi Open/Close Sidebar ----
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

    // ---- Toggle button ----
    if (menuToggle) {
        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sidebar && sidebar.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    // ---- Tombol close (X) di dalam sidebar ----
    if (sidebarClose) {
        sidebarClose.addEventListener('click', closeSidebar);
    }

    // ---- Klik overlay untuk tutup ----
    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }

    // ---- Klik area main wrapper → tutup sidebar (opsional) ----
    const mainWrapper = document.querySelector('.main-wrapper');
    if (mainWrapper) {
        mainWrapper.addEventListener('click', () => {
            if (sidebar && sidebar.classList.contains('open')) {
                closeSidebar();
            }
        });
    }

    // ---- Klik nav link → navigate + close sidebar ----
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

            // 🔧 Auto-close sidebar di mobile
            closeSidebar();

            // Refresh
            if (page === 'map' && map) {
                setTimeout(() => map.invalidateSize(), 200);
            }
            if (page === 'stats') {
                updateCharts(currentDataArray);
                updateEventChart(currentEvents);
            }
        });
    });

    // ---- Handle ESC key → tutup sidebar ----
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });

    // ---- Handle swipe gesture (opsional) ----
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });

    function handleSwipe() {
        const swipeDistance = touchEndX - touchStartX;

        // Swipe kanan dari kiri layar → buka sidebar
        if (touchStartX < 50 && swipeDistance > 80) {
            openSidebar();
        }

        // Swipe kiri → tutup sidebar
        if (swipeDistance < -80 && sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    }
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
// 🔒 ADMIN PANEL — HIDDEN ACCESS
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

    // --------------------------------------------------------
    // METODE 1: Klik 5x cepat pada header "Pengaturan Sistem"
    // --------------------------------------------------------
    header.addEventListener('click', () => {
        adminClickCount++;
        clearTimeout(adminClickTimer);
        adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 800);

        if (adminClickCount >= 5) {
            adminClickCount = 0;
            unlockAdmin();
        }
    });

    // --------------------------------------------------------
    // METODE 2: Ketik "admin" di keyboard (halaman settings aktif)
    // --------------------------------------------------------
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

    // --------------------------------------------------------
    // UNLOCK / LOCK
    // --------------------------------------------------------
    function unlockAdmin() {
        if (adminUnlocked) return;
        adminUnlocked = true;
        panel.style.display = 'block';
        addActiveIndicator();
        console.log('🔓 Admin panel unlocked');
    }

    function lockAdmin() {
        adminUnlocked = false;
        panel.style.display = 'none';
        removeActiveIndicator();
        console.log('🔒 Admin panel locked');
    }

    function addActiveIndicator() {
        if (document.querySelector('.admin-active-indicator')) return;
        const dot = document.createElement('div');
        dot.className = 'admin-active-indicator';
        document.body.appendChild(dot);
    }

    function removeActiveIndicator() {
        const dot = document.querySelector('.admin-active-indicator');
        if (dot) dot.remove();
    }

    // --------------------------------------------------------
    // ADMIN BUTTONS
    // --------------------------------------------------------

    // 1. Reset Tampilan (tidak hapus data)
    const btnResetView = document.getElementById('btnAdminResetView');
    if (btnResetView) {
        btnResetView.addEventListener('click', () => {
            resetViewOnly();
        });
    }

    // 2. Hapus flood_points
    const btnClearFlood = document.getElementById('btnAdminClearFlood');
    if (btnClearFlood) {
        btnClearFlood.addEventListener('click', () => {
            if (!confirm('⚠️ Hapus SEMUA flood_points? Tidak bisa dibatalkan!')) return;
            if (!confirm('Yakin? Data tidak bisa dikembalikan.')) return;

            clearFloodPoints()
                .then(() => {
                    console.log('🗑️ flood_points cleared');
                    alert('✅ Data genangan dihapus');
                    resetViewOnly();
                })
                .catch(err => alert('❌ Gagal: ' + err.message));
        });
    }

    // 3. Hapus road_events
    const btnClearEvents = document.getElementById('btnAdminClearEvents');
    if (btnClearEvents) {
        btnClearEvents.addEventListener('click', () => {
            if (!confirm('⚠️ Hapus SEMUA road_events? Tidak bisa dibatalkan!')) return;
            if (!confirm('Yakin? Data tidak bisa dikembalikan.')) return;

            clearRoadEvents()
                .then(() => {
                    console.log('🗑️ road_events cleared');
                    alert('✅ Data event jalan dihapus');
                    if (typeof roadEventLayerGroup !== 'undefined' && roadEventLayerGroup) {
                        roadEventLayerGroup.clearLayers();
                    }
                })
                .catch(err => alert('❌ Gagal: ' + err.message));
        });
    }

    // 4. Full Reset
    const btnFullReset = document.getElementById('btnAdminFullReset');
    if (btnFullReset) {
        btnFullReset.addEventListener('click', () => {
            if (!confirm('⚠️⚠️ FULL RESET — Hapus SEMUA data (flood + events)?')) return;
            if (!confirm('Yakin? Tidak bisa dikembalikan!')) return;
            if (!confirm('Terakhir kali — lanjutkan?')) return;

            Promise.all([clearFloodPoints(), clearRoadEvents()])
                .then(() => {
                    console.log('💥 Full reset done');
                    alert('✅ Full reset selesai');
                    resetViewOnly();
                    if (typeof roadEventLayerGroup !== 'undefined' && roadEventLayerGroup) {
                        roadEventLayerGroup.clearLayers();
                    }
                })
                .catch(err => alert('❌ Gagal: ' + err.message));
        });
    }

    // 5. Lock Panel
    const btnLock = document.getElementById('btnAdminLock');
    if (btnLock) {
        btnLock.addEventListener('click', () => {
            lockAdmin();
        });
    }
}

// ============================================================
// RESET TAMPILAN (hanya visual, tidak hapus data)
// ============================================================

function resetViewOnly() {
    console.log('🔄 Reset tampilan saja');

    // Reset peta ke posisi awal
    if (typeof map !== 'undefined' && map) {
        map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
    }

    // Clear layer visual
    if (typeof floodLayerGroup !== 'undefined' && floodLayerGroup) {
        floodLayerGroup.clearLayers();
    }
    if (typeof roadEventLayerGroup !== 'undefined' && roadEventLayerGroup) {
        roadEventLayerGroup.clearLayers();
    }
    if (typeof vehicleMarker !== 'undefined' && vehicleMarker && map) {
        vehicleMarker.setLatLng(MAP_CONFIG.center);
    }

    // Reset cache
    if (typeof segmentPolylines !== 'undefined') {
        segmentPolylines = {};
    }
    if (typeof roadEventMarkers !== 'undefined') {
        roadEventMarkers = [];
    }

    // Reset floating stats
    if (typeof updateMapStats === 'function') {
        updateMapStats(0, 0);
    }

    // Reset notifikasi
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
            <td>${(e.magnitude_g || 0).toFixed(2)} g</td>
            <td>${(e.z_axis_g || 0).toFixed(2)} g</td>
            <td style="font-size:11px;">
                ${(e.latitude||0).toFixed(5)}, ${(e.longitude||0).toFixed(5)}
            </td>
        </tr>`;
    }).join('');

    setText('eventCount', `(${arr.length} entri)`);
}

// ============================================================
// EXPORT BUTTONS
// ============================================================

function setupExportButtons() {
    // CSV
    const csv = document.getElementById('btnExportEventsCSV');
    if (csv) {
        csv.addEventListener('click', () => {
            const arr = Object.values(currentEvents);
            if (arr.length === 0) {
                alert('Tidak ada event untuk diexport');
                return;
            }
            const headers = ['timestamp', 'event_type', 'latitude', 'longitude',
                             'magnitude_g', 'z_axis_g'];
            let out = headers.join(',') + '\n';
            arr.forEach(e => {
                out += headers.map(h => `"${e[h] !== undefined ? e[h] : ''}"`).join(',') + '\n';
            });
            downloadFile(out, `road_events_${Date.now()}.csv`, 'text/csv');
        });
    }

    // JSON
    const json = document.getElementById('btnExportEventsJSON');
    if (json) {
        json.addEventListener('click', () => {
            downloadFile(JSON.stringify(currentEvents, null, 2),
                `road_events_${Date.now()}.json`, 'application/json');
        });
    }

    // Clear
    const clr = document.getElementById('btnClearEvents');
    if (clr) {
        clr.addEventListener('click', () => {
            if (!confirm('Hapus semua event jalan?')) return;
            clearRoadEvents().then(() => alert('✅ Event dihapus'));
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

console.log('✅ app.js loaded');