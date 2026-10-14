// ============================================================
// APP.JS — Main Application Logic
// FloodMap Makassar — Sensor Fusion Dashboard + Sensor Logs
// ============================================================

const APP = {
    thresholdSiaga: 10,
    thresholdBahaya: 20,
    thresholdImu: 0.30
};

// ============================================================
// VARIABEL GLOBAL
// ============================================================
let currentAllData = [];
let currentVehicleData = [];
let currentFloodData = [];
let currentOffRoadData = [];
let currentEvents = {};

// Sensor Logs
let currentLogsData = [];
let filteredLogsData = [];

// Timers
let currentReadingTimer = null;
let deviceStatusTimer = null;
const READING_TIMEOUT_MS = 8000;
const DEVICE_TIMEOUT_MS  = 20000;

// Firebase connection
let firebaseConnected = true;

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 FloodMap Makassar dimulai...');

    // Cek koneksi Firebase
    if (typeof db !== 'undefined') {
        db.ref('.info/connected').on('value', (snap) => {
            firebaseConnected = snap.val() === true;
            console.log('🔥 Firebase connection:', firebaseConnected);
        });
    }

    initMap();
    setupNavigation();
    setupSettings();
    setupMapFilters();
    setupAdminPanel();
    setupLegendToggle();
    setupSensorLogsHandlers();      // 🔧 Sensor Logs

    // ============================================================
    // LISTENER: FLOOD POINTS
    // ============================================================
    onFloodPoints(async (data) => {
        const rawArray = Object.values(data || {});
        console.log('📦 Raw flood_points:', rawArray.length);

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
                source:     String(p.source || 'gps').toLowerCase().trim(),
                satellites: parseInt(p.satellites) || 0
            }))
            .filter(p => !isNaN(p.latitude) && !isNaN(p.longitude))
            .sort((a, b) => a.timestamp - b.timestamp);

        const sources = [...new Set(allData.map(d => d.source))];
        console.log('📊 Sources:', sources);
        if (allData.length > 0) console.log('📊 Sample:', allData[0]);

        currentAllData = allData;
        currentVehicleData = allData.filter(p => p.source === 'gps');

        const withFlood = allData.filter(p =>
            p.source === 'gps' &&
            p.depth > 0 &&
            p.segment_id &&
            p.depth_valid !== false
        );

        if (withFlood.length > 0 && typeof matchToRoad === 'function') {
            const matched = await matchToRoad(withFlood);
            currentFloodData   = matched.filter(p => p.matched);
            currentOffRoadData = matched.filter(p => !p.matched);
        } else {
            currentFloodData = [];
            currentOffRoadData = [];
        }

        console.log(`📊 GPS: ${currentVehicleData.length} | Flood: ${currentFloodData.length} | Off-road: ${currentOffRoadData.length}`);

        updateUI(currentAllData, { filterTable: true });
        updateHistoryTable(currentAllData);
        updateNotif(currentAllData);
        updateCharts(currentFloodData);
        updateOffRoadStats(currentOffRoadData);

        redrawMapFromData(currentVehicleData, currentFloodData, currentOffRoadData)
            .catch(err => console.error('Map error:', err));

        if (currentVehicleData.length > 0 && typeof prefetchStreetNames === 'function') {
            prefetchStreetNames(currentVehicleData).then(() => {
                currentAllData.forEach(p => {
                    const name = geocodeCache[gridKey(p.latitude, p.longitude)];
                    if (name) p.location = name;
                });
                updateUI(currentAllData, { filterTable: true });
                updateHistoryTable(currentAllData);
            });
        }
    });

    // ============================================================
    // LISTENER: CURRENT READING
    // ============================================================
    onCurrentReading((reading) => {
        if (!reading || !reading.depth) return;

        const readingTs = reading.timestamp || 0;
        if (!window._lastReadingTs || readingTs !== window._lastReadingTs) {
            window._lastReadingTs = readingTs;
            window._lastReadingReceivedAt = Date.now();
        }

        const depth  = parseFloat(reading.depth) || 0;
        const imuZ   = parseFloat(reading.imuZ) || 0;
        const lat    = parseFloat(reading.latitude) || 0;
        const lng    = parseFloat(reading.longitude) || 0;
        const sats   = parseInt(reading.satellites) || 0;
        const status = (reading.status || 'aman').toLowerCase();
        const source = reading.source || 'fallback';

        const depthEl = document.getElementById('currentDepth');
        if (depthEl) {
            depthEl.textContent = depth.toFixed(1) + ' cm';
            depthEl.style.color = status === 'bahaya' ? '#ef4444' :
                                  status === 'siaga'  ? '#f59e0b' : '#22c55e';
        }

        const imuEl = document.getElementById('currentImu');
        if (imuEl) imuEl.textContent = imuZ.toFixed(2) + ' g';

        const coordEl = document.getElementById('currentCoord');
        if (coordEl) {
            coordEl.textContent = lat.toFixed(6) + '°, ' + lng.toFixed(6) + '°';
            coordEl.style.color = (source === 'gps' && sats >= 4) ? '#22c55e' : '#f59e0b';
        }

        clearTimeout(currentReadingTimer);
        currentReadingTimer = setTimeout(() => {
            if (firebaseConnected) clearSensorReadout();
        }, READING_TIMEOUT_MS);
    });

    // ============================================================
    // LISTENER: ROAD EVENTS
    // ============================================================
    onRoadEvents((data) => {
        currentEvents = data || {};
        window._roadEventsCache = currentEvents;

        if (typeof renderRoadEvents === 'function') renderRoadEvents(currentEvents);
        if (typeof updateEventChart === 'function') updateEventChart(currentEvents);
        updateEventsTable(currentEvents);
    });

    // ============================================================
    // LISTENER: SENSOR LOGS
    // ============================================================
    if (typeof onSensorLogs === 'function') {
        onSensorLogs((data) => {
            console.log('📊 Sensor logs loaded:', Object.keys(data).length);
            updateSensorLogsUI(data);
        });
    }

    // ============================================================
    // LISTENER: SYSTEM STATUS
    // ============================================================
    onSystemStatus((status) => {
        const lastUpdate = status.last_update || 0;
        const now = Date.now();

        const isFirstLoad = window._lastStatusUpdate === undefined;
        const isNewValue  = !isFirstLoad && lastUpdate !== window._lastStatusUpdate;

        if (isNewValue) {
            window._lastStatusReceivedAt = now;
            window._hasLiveUpdate = true;
        } else if (isFirstLoad) {
            window._hasLiveUpdate = false;
        }

        window._lastStatusUpdate = lastUpdate;

        const timeSinceLive = now - (window._lastStatusReceivedAt || 0);
        const isFresh = window._hasLiveUpdate && timeSinceLive < DEVICE_TIMEOUT_MS;

        const isEspOnline = isFresh && (
            status.esp32_online === true ||
            status.esp32_online === 'true' ||
            status.esp32_online === 1 ||
            status.esp32_online === '1'
        );

        const ind = document.getElementById('espIndicator');
        if (ind) {
            if (!firebaseConnected) {
                ind.innerHTML = '<i class="ti ti-circle-filled" style="color:#f59e0b;"></i> Firebase Terputus';
            } else if (!window._hasLiveUpdate) {
                ind.innerHTML = '<i class="ti ti-circle-filled" style="color:#94a3b8;"></i> ESP32 Menunggu...';
            } else if (isEspOnline) {
                ind.innerHTML = '<i class="ti ti-circle-filled" style="color:#22c55e;"></i> ESP32 Online';
            } else {
                ind.innerHTML = '<i class="ti ti-circle-filled" style="color:#ef4444;"></i> ESP32 Offline';
            }
        }

        if (isFresh && status.last_update) {
            setText('lastUpdate', 'Update: ' + formatTime(status.last_update));
        } else {
            setText('lastUpdate', 'Update: --:--:--');
        }

        if (!firebaseConnected || !window._hasLiveUpdate) {
            updateSensorStatus({
                sensor: 'menunggu', imu: 'menunggu',
                gps: 'menunggu', esp: 'menunggu'
            });
        } else if (isFresh) {
            updateSensorStatus({
                sensor: status.sensor_status || 'menunggu',
                imu:    status.imu_status    || 'menunggu',
                gps:    status.gps_status    || 'menunggu',
                esp:    isEspOnline ? 'online' : 'offline'
            });
        } else {
            updateSensorStatus({
                sensor: 'offline', imu: 'offline',
                gps: 'offline', esp: 'offline'
            });
        }

        clearTimeout(deviceStatusTimer);
        deviceStatusTimer = setTimeout(() => {
            if (firebaseConnected) forceOfflineStatus();
        }, DEVICE_TIMEOUT_MS);
    });

    // Init road events layer
    setTimeout(() => {
        if (typeof initRoadEventLayer === 'function') initRoadEventLayer(map);
        if (typeof listenRoadEvents === 'function') listenRoadEvents();
    }, 500);

    setupExportButtons();

    // Tombol focus kendaraan
    const btnFocus = document.getElementById('btnFocusVehicle');
    if (btnFocus) {
        btnFocus.addEventListener('click', () => {
            if (!currentVehicleData || currentVehicleData.length === 0) {
                alert('Belum ada data kendaraan. Pastikan GPS sudah fix (sat ≥ 4).');
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
// CLEAR SENSOR READOUT
// ============================================================
function clearSensorReadout() {
    console.log('⚠️ Current reading timeout — clear display');

    const depthEl = document.getElementById('currentDepth');
    if (depthEl) {
        depthEl.textContent = '-- cm';
        depthEl.style.color = '#94a3b8';
    }
    const imuEl = document.getElementById('currentImu');
    if (imuEl) imuEl.textContent = '-- g';
    const coordEl = document.getElementById('currentCoord');
    if (coordEl) {
        coordEl.textContent = '--°, --°';
        coordEl.style.color = '#94a3b8';
    }
}

// ============================================================
// FORCE OFFLINE
// ============================================================
function forceOfflineStatus() {
    console.log('⚠️ Device timeout — set offline');

    const ind = document.getElementById('espIndicator');
    if (ind) {
        ind.innerHTML = '<i class="ti ti-circle-filled" style="color:#ef4444;"></i> ESP32 Offline';
    }
    setText('lastUpdate', 'Update: --:--:--');

    updateSensorStatus({
        sensor: 'offline', imu: 'offline',
        gps: 'offline', esp: 'offline'
    });

    clearSensorReadout();
}

// ============================================================
// LEGEND TOGGLE
// ============================================================
function setupLegendToggle() {
    const legend = document.getElementById('mapLegend');
    const toggle = document.getElementById('legendToggle');

    if (!legend || !toggle) return;

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        legend.classList.toggle('collapsed');
        localStorage.setItem('legendCollapsed', legend.classList.contains('collapsed'));
    });

    const savedState = localStorage.getItem('legendCollapsed');
    if (savedState === 'true') legend.classList.add('collapsed');
    if (window.innerWidth <= 768 && savedState === null) legend.classList.add('collapsed');

    console.log('✅ Legend toggle ready');
}

// ============================================================
// SENSOR LOGS — HANDLERS
// ============================================================
function setupSensorLogsHandlers() {
    // Search
    const searchInput = document.getElementById('logsSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(window._logsSearchTimer);
            window._logsSearchTimer = setTimeout(applyLogsFilter, 300);
        });
    }

    // Filter status
    const filterStatus = document.getElementById('logsFilterStatus');
    if (filterStatus) filterStatus.addEventListener('change', applyLogsFilter);

    // Filter source
    const filterSource = document.getElementById('logsFilterSource');
    if (filterSource) filterSource.addEventListener('change', applyLogsFilter);

    // Refresh
    const btnRefresh = document.getElementById('btnRefreshLogs');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            btnRefresh.innerHTML = '<i class="ti ti-loader ti-spin"></i>';
            if (typeof onSensorLogsOnce === 'function') {
                onSensorLogsOnce((data) => {
                    updateSensorLogsUI(data);
                    btnRefresh.innerHTML = '<i class="ti ti-refresh"></i>';
                });
            } else {
                btnRefresh.innerHTML = '<i class="ti ti-refresh"></i>';
            }
        });
    }

    // Export buttons
    const btnCSV = document.getElementById('btnExportLogsCSV');
    if (btnCSV) btnCSV.addEventListener('click', () => exportLogsCSV());

    const btnJSON = document.getElementById('btnExportLogsJSON');
    if (btnJSON) btnJSON.addEventListener('click', () => exportLogsJSON());

    const btnExcel = document.getElementById('btnExportLogsExcel');
    if (btnExcel) btnExcel.addEventListener('click', () => exportLogsExcel());

    console.log('✅ Sensor logs handlers ready');
}

// ============================================================
// SENSOR LOGS — UI UPDATE
// ============================================================
function updateSensorLogsUI(logsData) {
    currentLogsData = logsData;
    applyLogsFilter();
    updateLogsStats();
}

function applyLogsFilter() {
    const search = (document.getElementById('logsSearch')?.value || '').toLowerCase().trim();
    const filterStatus = document.getElementById('logsFilterStatus')?.value || 'all';
    const filterSource = document.getElementById('logsFilterSource')?.value || 'all';

    filteredLogsData = Object.values(currentLogsData || {})
        .map(log => ({
            ...log,
            _depth: parseFloat(log.depth) || 0,
            _timestamp: parseFloat(log.timestamp) || 0,
            _lat: parseFloat(log.latitude) || 0,
            _lng: parseFloat(log.longitude) || 0
        }))
        .filter(log => {
            if (filterStatus !== 'all' && (log.status || '').toLowerCase() !== filterStatus) return false;
            if (filterSource !== 'all' && (log.source || '').toLowerCase() !== filterSource) return false;
            if (search) {
                const text = `${log.status} ${log.source} ${log.segment_id} ${log.latitude} ${log.longitude}`.toLowerCase();
                if (!text.includes(search)) return false;
            }
            return true;
        })
        .sort((a, b) => b._timestamp - a._timestamp);

    renderLogsTable();
}

function renderLogsTable() {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;

    const countEl = document.getElementById('logsCount');

    if (filteredLogsData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="14" class="empty">Tidak ada data</td></tr>';
        if (countEl) countEl.textContent = '(0 entri)';
        return;
    }

    const latest = filteredLogsData.slice(0, 100);

    tbody.innerHTML = latest.map((log, i) => {
        const st = getStatusLabel(log.status);
        const lat = parseFloat(log.latitude) || 0;
        const lng = parseFloat(log.longitude) || 0;
        const depth = parseFloat(log.depth) || 0;
        const raw = parseFloat(log.depth_raw) || 0;
        const hdop = parseFloat(log.hdop) || 0;
        const imuZ = parseFloat(log.imuZ) || 0;
        const imuMag = parseFloat(log.imuMag) || 0;
        const pitch = parseFloat(log.pitch) || 0;
        const roll = parseFloat(log.roll) || 0;
        const segment = (log.segment_id || '-').substring(0, 12);

        return `<tr>
            <td>${i + 1}</td>
            <td style="white-space:nowrap;">${formatTime(log.timestamp)}</td>
            <td><strong>${depth.toFixed(1)}</strong></td>
            <td><span class="status-badge ${st.cls}">${st.label}</span></td>
            <td>${raw.toFixed(1)}</td>
            <td style="font-size:10px; font-family:monospace;">${lat.toFixed(5)},<br>${lng.toFixed(5)}</td>
            <td>${log.satellites || 0}</td>
            <td>${hdop.toFixed(1)}</td>
            <td>${imuZ.toFixed(2)}</td>
            <td>${imuMag.toFixed(2)}</td>
            <td>${pitch.toFixed(1)}°</td>
            <td>${roll.toFixed(1)}°</td>
            <td style="font-size:10px;">${segment}</td>
            <td><span class="sub-badge">${log.source || '-'}</span></td>
        </tr>`;
    }).join('');

    if (countEl) {
        countEl.textContent = `(${latest.length} / ${filteredLogsData.length} entri)`;
    }
}

function updateLogsStats() {
    const allLogs = Object.values(currentLogsData || {});
    const total = allLogs.length;

    const totalEl = document.getElementById('logsTotal');
    if (totalEl) totalEl.textContent = total;

    if (total === 0) return;

    const latest = allLogs.reduce((max, l) => {
        const t = parseFloat(l.timestamp) || 0;
        return t > max ? t : max;
    }, 0);
    const latestEl = document.getElementById('logsLatest');
    if (latestEl) latestEl.textContent = formatTime(latest);

    const depths = allLogs.map(l => parseFloat(l.depth) || 0).filter(d => d > 0);
    if (depths.length > 0) {
        const avg = depths.reduce((a, b) => a + b, 0) / depths.length;
        const max = Math.max(...depths);

        const avgEl = document.getElementById('logsAvgDepth');
        if (avgEl) avgEl.textContent = avg.toFixed(1);

        const maxEl = document.getElementById('logsMaxDepth');
        if (maxEl) maxEl.textContent = max.toFixed(1);
    }
}

// ============================================================
// SENSOR LOGS — EXPORT CSV
// ============================================================
function exportLogsCSV() {
    const data = filteredLogsData;
    if (data.length === 0) {
        alert('Tidak ada data untuk diexport');
        return;
    }

    const headers = [
        'No', 'Timestamp', 'Waktu', 'Depth_cm', 'Status', 'Raw_cm',
        'Latitude', 'Longitude', 'Satellites', 'HDOP', 'Source',
        'IMU_Z', 'IMU_Mag', 'Pitch', 'Roll', 'Segment_ID', 'Device'
    ];

    let csv = headers.join(',') + '\n';

    data.forEach((log, i) => {
        const row = [
            i + 1,
            log.timestamp || '',
            formatTime(log.timestamp),
            parseFloat(log.depth) || 0,
            log.status || '',
            parseFloat(log.depth_raw) || 0,
            log.latitude || '',
            log.longitude || '',
            log.satellites || 0,
            log.hdop || '',
            log.source || '',
            log.imuZ || '',
            log.imuMag || '',
            log.pitch || '',
            log.roll || '',
            log.segment_id || '',
            log.device || ''
        ];
        csv += row.map(v => `"${v}"`).join(',') + '\n';
    });

    downloadFile(csv, `sensor_logs_${formatDateForFile()}.csv`, 'text/csv;charset=utf-8;');
    console.log(`✅ CSV exported: ${data.length} entri`);
}

// ============================================================
// SENSOR LOGS — EXPORT JSON
// ============================================================
function exportLogsJSON() {
    const data = filteredLogsData;
    if (data.length === 0) {
        alert('Tidak ada data untuk diexport');
        return;
    }

    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `sensor_logs_${formatDateForFile()}.json`, 'application/json');
    console.log(`✅ JSON exported: ${data.length} entri`);
}

// ============================================================
// SENSOR LOGS — EXPORT EXCEL
// ============================================================
function exportLogsExcel() {
    const data = filteredLogsData;
    if (data.length === 0) {
        alert('Tidak ada data untuk diexport');
        return;
    }

    let html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel">';
    html += '<head><meta charset="UTF-8"></head><body>';
    html += '<table border="1">';

    html += '<tr style="background:#0f172a; color:#fff; font-weight:bold;">';
    ['No', 'Waktu', 'Depth (cm)', 'Status', 'Raw (cm)', 'Latitude', 'Longitude',
     'Satellites', 'HDOP', 'Source', 'IMU Z', 'IMU Mag', 'Pitch', 'Roll', 'Segment', 'Device']
        .forEach(h => html += `<th>${h}</th>`);
    html += '</tr>';

    data.forEach((log, i) => {
        html += '<tr>';
        html += `<td>${i + 1}</td>`;
        html += `<td>${new Date(parseFloat(log.timestamp)).toLocaleString('id-ID')}</td>`;
        html += `<td>${parseFloat(log.depth) || 0}</td>`;
        html += `<td>${log.status || ''}</td>`;
        html += `<td>${parseFloat(log.depth_raw) || 0}</td>`;
        html += `<td>${log.latitude || ''}</td>`;
        html += `<td>${log.longitude || ''}</td>`;
        html += `<td>${log.satellites || 0}</td>`;
        html += `<td>${log.hdop || ''}</td>`;
        html += `<td>${log.source || ''}</td>`;
        html += `<td>${log.imuZ || ''}</td>`;
        html += `<td>${log.imuMag || ''}</td>`;
        html += `<td>${log.pitch || ''}</td>`;
        html += `<td>${log.roll || ''}</td>`;
        html += `<td>${log.segment_id || ''}</td>`;
        html += `<td>${log.device || ''}</td>`;
        html += '</tr>';
    });

    html += '</table></body></html>';

    downloadFile(html, `sensor_logs_${formatDateForFile()}.xls`, 'application/vnd.ms-excel');
    console.log(`✅ Excel exported: ${data.length} entri`);
}

function formatDateForFile() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

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

            if (page === 'map' && map) setTimeout(() => map.invalidateSize(), 200);
            if (page === 'stats') {
                updateCharts(currentFloodData);
                if (typeof updateEventChart === 'function') updateEventChart(currentEvents);
            }
            if (page === 'sensorlogs') {
                applyLogsFilter();
                updateLogsStats();
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar && sidebar.classList.contains('open')) closeSidebar();
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
    });
}

// ============================================================
// ADMIN PANEL
// ============================================================
let adminUnlocked = false;
let adminClickCount = 0;
let adminClickTimer = null;

function setupAdminPanel() {
    const header = document.getElementById('settingsHeader');
    const panel = document.getElementById('adminPanel');
    if (!header || !panel) return;

    header.addEventListener('click', () => {
        adminClickCount++;
        clearTimeout(adminClickTimer);
        adminClickTimer = setTimeout(() => { adminClickCount = 0; }, 800);
        if (adminClickCount >= 5) { adminClickCount = 0; unlockAdmin(); }
    });

    let typedBuffer = '';
    document.addEventListener('keydown', (e) => {
        const currentPage = document.querySelector('.page-content.active');
        if (!currentPage || currentPage.id !== 'page-settings') return;
        if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
            typedBuffer += e.key.toLowerCase();
            if (typedBuffer.length > 10) typedBuffer = typedBuffer.slice(-10);
            if (typedBuffer.endsWith('admin')) { typedBuffer = ''; unlockAdmin(); }
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
    }

    function lockAdmin() {
        adminUnlocked = false;
        panel.style.display = 'none';
        const dot = document.querySelector('.admin-active-indicator');
        if (dot) dot.remove();
    }

    const btnResetView = document.getElementById('btnAdminResetView');
    if (btnResetView) btnResetView.addEventListener('click', () => resetViewOnly());

    const btnClearFlood = document.getElementById('btnAdminClearFlood');
    if (btnClearFlood) {
        btnClearFlood.addEventListener('click', () => {
            if (!confirm('⚠️ Hapus SEMUA flood_points?')) return;
            if (!confirm('Yakin?')) return;
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
            Promise.all([clearFloodPoints(), clearRoadEvents()]).then(() => {
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
// RESET TAMPILAN
// ============================================================
function resetViewOnly() {
    if (typeof map !== 'undefined' && map) map.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
    if (typeof floodLayerGroup !== 'undefined' && floodLayerGroup) floodLayerGroup.clearLayers();
    if (typeof roadEventLayerGroup !== 'undefined' && roadEventLayerGroup) roadEventLayerGroup.clearLayers();
    if (typeof vehicleMarker !== 'undefined' && vehicleMarker && map) {
        vehicleMarker.setLatLng(MAP_CONFIG.center);
    }
    if (typeof segmentPolylines !== 'undefined') segmentPolylines = {};
    if (typeof roadEventMarkers !== 'undefined') roadEventMarkers = [];
    if (typeof updateMapStats === 'function') updateMapStats(0, 0, 0);
    if (typeof isFirstLoad !== 'undefined') isFirstLoad = true;

    const notif = document.getElementById('notifBox');
    if (notif) notif.innerHTML = '<div class="notif-item info">Tampilan direset</div>';
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
// EXPORT BUTTONS (untuk Event Jalan)
// ============================================================
function setupExportButtons() {
    const csv = document.getElementById('btnExportEventsCSV');
    if (csv) {
        csv.addEventListener('click', () => {
            const arr = Object.values(currentEvents);
            if (arr.length === 0) { alert('Tidak ada event'); return; }
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
window.updateSensorLogsUI = updateSensorLogsUI;
window.applyLogsFilter = applyLogsFilter;

console.log('✅ app.js loaded');