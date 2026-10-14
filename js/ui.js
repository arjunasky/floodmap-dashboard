// ============================================================
// UI.JS — Update UI Elements
// ============================================================

function formatTime(ts) {
    if (!ts) return '--:--:--';
    const d = new Date(ts);
    return String(d.getHours()).padStart(2,'0') + ':' +
           String(d.getMinutes()).padStart(2,'0') + ':' +
           String(d.getSeconds()).padStart(2,'0');
}

function getStatusLabel(status) {
    const s = (status || '').toLowerCase();
    if (s === 'bahaya') return { label: 'Bahaya', cls: 'bahaya' };
    if (s === 'siaga')  return { label: 'Siaga',  cls: 'siaga' };
    if (s === 'suppressed') return { label: 'Diabaikan', cls: 'suppressed' };
    return { label: 'Aman', cls: 'aman' };
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ============================================================
// LOCATION NAME
// ============================================================
function getLocationName(p) {
    if (typeof geocodeCache !== 'undefined' && typeof gridKey === 'function') {
        const key = gridKey(p.latitude, p.longitude);
        if (geocodeCache[key]) return geocodeCache[key];
    }
    if (p.location && p.location !== '-' && p.location !== '' && p.location !== 'Auto') {
        return p.location;
    }
    return `Koordinat ${(p.latitude||0).toFixed(4)}, ${(p.longitude||0).toFixed(4)}`;
}

// ============================================================
// UPDATE UI — Stat cards + Tabel
// ============================================================
function updateUI(dataArray, options = {}) {
    const { filterTable = false } = options;

    if (!dataArray || dataArray.length === 0) {
        ['totalPoints','amanCount','siagaCount','bahayaCount'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '0';
        });
        const tb = document.getElementById('tableBody');
        if (tb) tb.innerHTML = '<tr><td colspan="4" class="empty">Belum ada data</td></tr>';
        return;
    }

    const total = dataArray.length;
    const aman = dataArray.filter(d => d.status === 'aman').length;
    const siaga = dataArray.filter(d => d.status === 'siaga').length;
    const bahaya = dataArray.filter(d => d.status === 'bahaya').length;

    setText('totalPoints', total);
    setText('amanCount', aman);
    setText('siagaCount', siaga);
    setText('bahayaCount', bahaya);

    const tb = document.getElementById('tableBody');
    if (!tb) return;

    let tableData = dataArray;
    if (filterTable) {
        tableData = dataArray.filter(p => p.source === 'gps');
    }

    if (tableData.length === 0) {
        tb.innerHTML = '<tr><td colspan="4" class="empty">GPS belum akurat — menunggu data</td></tr>';
        return;
    }

    const latest = [...tableData]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);

    tb.innerHTML = latest.map(d => {
        const st = getStatusLabel(d.status);
        const loc = getLocationName(d);
        return `<tr>
            <td>${formatTime(d.timestamp)}</td>
            <td>${loc}</td>
            <td><strong>${d.depth}</strong> cm</td>
            <td><span class="status-badge ${st.cls}">${st.label}</span></td>
        </tr>`;
    }).join('');
}

// ============================================================
// HISTORY TABLE
// ============================================================
function updateHistoryTable(dataArray) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    if (!dataArray || dataArray.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">Tidak ada riwayat</td></tr>';
        setText('historyCount', '(0 entri)');
        return;
    }

    const sorted = [...dataArray].sort((a, b) => b.timestamp - a.timestamp);

    tbody.innerHTML = sorted.map((d, i) => {
        const st = getStatusLabel(d.status);
        const loc = getLocationName(d);
        return `<tr>
            <td>${i+1}</td>
            <td>${formatTime(d.timestamp)}</td>
            <td>${loc}</td>
            <td>${d.depth}</td>
            <td><span class="status-badge ${st.cls}">${st.label}</span></td>
            <td style="font-size:11px; color:#64748b;">
                ${(d.latitude||0).toFixed(4)}, ${(d.longitude||0).toFixed(4)}
            </td>
        </tr>`;
    }).join('');

    setText('historyCount', `(${dataArray.length} entri)`);
}

// ============================================================
// NOTIFIKASI
// ============================================================
function updateNotif(dataArray) {
    const box = document.getElementById('notifBox');
    if (!box) return;

    if (!dataArray || dataArray.length === 0) {
        box.innerHTML = '<div class="notif-item info">Sistem siap memantau</div>';
        return;
    }

    const sorted = [...dataArray].sort((a, b) => b.timestamp - a.timestamp);
    const danger = sorted.find(d => d.status === 'bahaya');
    const warning = sorted.find(d => d.status === 'siaga');
    const aman = sorted.find(d => d.status === 'aman');

    let html = '';
    if (danger) {
        const loc = getLocationName(danger);
        html += `<div class="notif-item danger"><i class="ti ti-alert-triangle"></i> Bahaya — ${loc} (${danger.depth} cm)</div>`;
    }
    if (warning) {
        const loc = getLocationName(warning);
        html += `<div class="notif-item warning"><i class="ti ti-alert-circle"></i> Siaga — ${loc} (${warning.depth} cm)</div>`;
    }
    if (!html && aman) {
        const loc = getLocationName(aman);
        html = `<div class="notif-item info"><i class="ti ti-info-circle"></i> Aman — ${loc} (${aman.depth} cm)</div>`;
    }
    if (!html) html = '<div class="notif-item info">Sistem normal</div>';

    box.innerHTML = html;
}

// ============================================================
// OFF-ROAD STATS
// ============================================================
function updateOffRoadStats(offRoadData) {
    const el = document.getElementById('offRoadStats');
    if (!el) return;

    if (!offRoadData || offRoadData.length === 0) {
        el.innerHTML = `
            <div class="offroad-stat-item">
                <span class="offroad-stat-value" style="color:#94a3b8;">0</span>
                <span class="offroad-stat-label">Titik di Luar Jalan</span>
            </div>
            <div class="offroad-stat-item">
                <span class="offroad-stat-value" style="color:#94a3b8;">0.0</span>
                <span class="offroad-stat-label">Rata-rata (cm)</span>
            </div>
            <div class="offroad-stat-item">
                <span class="offroad-stat-value" style="color:#94a3b8;">0.0</span>
                <span class="offroad-stat-label">Maks (cm)</span>
            </div>
        `;
        return;
    }

    const total = offRoadData.length;
    const avgDepth = offRoadData.reduce((s, p) => s + (p.depth || 0), 0) / total;
    const maxDepth = Math.max(...offRoadData.map(p => p.depth || 0));

    el.innerHTML = `
        <div class="offroad-stat-item">
            <span class="offroad-stat-value" style="color:#f59e0b;">${total}</span>
            <span class="offroad-stat-label">Titik di Luar Jalan</span>
        </div>
        <div class="offroad-stat-item">
            <span class="offroad-stat-value" style="color:#64748b;">${avgDepth.toFixed(1)}</span>
            <span class="offroad-stat-label">Rata-rata (cm)</span>
        </div>
        <div class="offroad-stat-item">
            <span class="offroad-stat-value" style="color:#ef4444;">${maxDepth.toFixed(1)}</span>
            <span class="offroad-stat-label">Maks (cm)</span>
        </div>
    `;
}

// ============================================================
// SENSOR STATUS (Sidebar)
// ============================================================
function updateSensorStatus(status) {
    const map = {
        statusSensor: status.sensor,
        statusImu: status.imu,
        statusGps: status.gps,
        statusEsp: status.esp
    };

    Object.entries(map).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (!el) return;

        if (val === 'online' || val === 'aktif') {
            el.textContent = 'Aktif';
            el.className = 'badge success';
        } else if (val === 'simulasi' || val === 'fallback') {
            el.textContent = 'Fallback';
            el.className = 'badge warning';
        } else if (val === 'offline') {
            el.textContent = 'Offline';
            el.className = 'badge danger';
        } else if (val === 'menunggu') {
            el.textContent = 'Menunggu';
            el.className = 'badge';           // abu-abu
        } else {
            el.textContent = 'Menunggu';
            el.className = 'badge';
        }
    });
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
    const now = new Date();
    const el = document.getElementById('clockDisplay');
    if (el) {
        el.textContent =
            String(now.getHours()).padStart(2,'0') + ':' +
            String(now.getMinutes()).padStart(2,'0') + ':' +
            String(now.getSeconds()).padStart(2,'0');
    }
}

setInterval(updateClock, 1000);
updateClock();

// ============================================================
// EXPORT
// ============================================================
window.getLocationName = getLocationName;
window.formatTime = formatTime;
window.getStatusLabel = getStatusLabel;
window.updateOffRoadStats = updateOffRoadStats;

// ============================================================
// SENSOR LOGS — Render tabel
// ============================================================
let currentLogsData = [];
let filteredLogsData = [];

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

    const latest = filteredLogsData.slice(0, 100); // tampilkan max 100

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

    // Log terbaru
    const latest = allLogs.reduce((max, l) => {
        const t = parseFloat(l.timestamp) || 0;
        return t > max ? t : max;
    }, 0);
    const latestEl = document.getElementById('logsLatest');
    if (latestEl) latestEl.textContent = formatTime(latest);

    // Statistik depth
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

// Export ke window
window.updateSensorLogsUI = updateSensorLogsUI;
window.applyLogsFilter = applyLogsFilter;

console.log('✅ ui.js loaded');