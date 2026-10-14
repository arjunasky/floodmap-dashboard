// ============================================================
// UI.JS — Update UI Elements
// ============================================================

function formatTime(ts) {
    if (!ts) return '--:--:--';
    
    const d = new Date(parseFloat(ts));
    const options = {
        timeZone: 'Asia/Makassar',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    return new Intl.DateTimeFormat('id-ID', options).format(d);
}

function formatDateTime(ts) {
    if (!ts) return '--';
    
    const d = new Date(parseFloat(ts));
    const options = {
        timeZone: 'Asia/Makassar',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    return new Intl.DateTimeFormat('id-ID', options).format(d);
}

function getStatusLabel(status) {
    const s = (status || '').toLowerCase();
    if (s === 'bahaya') return { label: 'Bahaya', cls: 'bahaya' };
    if (s === 'siaga')  return { label: 'Siaga',  cls: 'siaga' };
    if (s === 'suppressed') return { label: 'Diabaikan', cls: 'suppressed' };
    if (s === 'kering') return { label: 'Kering', cls: 'kering' };
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
    const { filterTable = false, segmentCount = null } = options;

    if (!dataArray || dataArray.length === 0) {
        ['totalPoints','amanCount','siagaCount','bahayaCount'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '0';
        });
        const tb = document.getElementById('tableBody');
        if (tb) tb.innerHTML = '<tr><td colspan="4" class="empty">Belum ada data</td></tr>';
        return;
    }

    // 🔧 Pakai segmentCount kalau dikirim (jumlah genangan unik)
    if (segmentCount !== null && typeof currentFloodSegments !== 'undefined') {
        setText('totalPoints', segmentCount);
        const segAman = currentFloodSegments.filter(s => s.category === 'aman').length;
        const segSiaga = currentFloodSegments.filter(s => s.category === 'siaga').length;
        const segBahaya = currentFloodSegments.filter(s => s.category === 'bahaya').length;
        setText('amanCount', segAman);
        setText('siagaCount', segSiaga);
        setText('bahayaCount', segBahaya);
    } else {
        const total = dataArray.length;
        const aman = dataArray.filter(d => d.status === 'aman').length;
        const siaga = dataArray.filter(d => d.status === 'siaga').length;
        const bahaya = dataArray.filter(d => d.status === 'bahaya').length;
        setText('totalPoints', total);
        setText('amanCount', aman);
        setText('siagaCount', siaga);
        setText('bahayaCount', bahaya);
    }

    const tb = document.getElementById('tableBody');
    if (!tb) return;

    let tableData = dataArray;
    if (filterTable) {
        tableData = dataArray.filter(p => p.source === 'gps' && (p.depth || 0) >= 3);
    }

    if (tableData.length === 0) {
        tb.innerHTML = '<tr><td colspan="4" class="empty">Tidak ada genangan</td></tr>';
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
// FLOOD SEGMENTS TABLE — 1 baris per segment
// ============================================================
function updateFloodSegmentsTable(segments) {
    const tb = document.getElementById('floodSegmentsBody');
    if (!tb) return;

    const countEl = document.getElementById('segmentsCount');
    if (countEl) countEl.textContent = `(${segments.length} titik flood)`;

    if (!segments || segments.length === 0) {
        tb.innerHTML = '<tr><td colspan="7" class="empty">Belum ada genangan terdeteksi</td></tr>';
        return;
    }

    tb.innerHTML = segments.slice(0, 20).map((seg, i) => {
        const st = getStatusLabel(seg.category);
        const loc = getLocationName({
            latitude: seg.centerLat,
            longitude: seg.centerLng
        });

        return `<tr>
            <td>${i + 1}</td>
            <td>${formatTime(seg.lastTimestamp)}</td>
            <td>${loc}</td>
            <td><strong>${seg.avgDepth}</strong> cm</td>
            <td><span class="status-badge ${st.cls}">${st.label}</span></td>
            <td>${seg.lengthM} m</td>
            <td><span class="sub-badge">${seg.pointCount} titik</span></td>
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
// SENSOR STATUS
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
        } else {
            el.textContent = 'Menunggu';
            el.className = 'badge';
        }
    });
}

// ============================================================
// CLOCK — WITA
// ============================================================
function updateClock() {
    const el = document.getElementById('clockDisplay');
    if (!el) return;

    const options = {
        timeZone: 'Asia/Makassar',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    el.textContent = new Intl.DateTimeFormat('id-ID', options).format(new Date());
}

setInterval(updateClock, 1000);
updateClock();

// ============================================================
// EXPORT GLOBAL
// ============================================================
window.getLocationName = getLocationName;
window.formatTime = formatTime;
window.formatDateTime = formatDateTime;
window.getStatusLabel = getStatusLabel;
window.updateOffRoadStats = updateOffRoadStats;
window.updateFloodSegmentsTable = updateFloodSegmentsTable;

console.log('✅ ui.js loaded');