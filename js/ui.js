// ============================================================
// UI.JS — Update UI Elements
// FloodMap Makassar — Sensor Fusion Dashboard
// ============================================================

// ============================================================
// UTIL FORMAT
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
// GET LOCATION NAME — dengan fallback
// ============================================================
function getLocationName(p) {
    // 1. Cek cache geocoder (dari geocoder.js)
    if (typeof geocodeCache !== 'undefined' && typeof gridKey === 'function') {
        const key = gridKey(p.latitude, p.longitude);
        if (geocodeCache[key]) return geocodeCache[key];
    }

    // 2. Kalau data punya location valid
    if (p.location && p.location !== '-' && p.location !== '' && p.location !== 'Auto') {
        return p.location;
    }

    // 3. Fallback: koordinat
    return `Koordinat ${(p.latitude||0).toFixed(4)}, ${(p.longitude||0).toFixed(4)}`;
}

// ============================================================
// UPDATE UI UTAMA
// ============================================================

function updateUI(dataArray) {
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

    // ---- Table 10 terbaru ----
    const tb = document.getElementById('tableBody');
    if (tb) {
        const latest = [...dataArray]
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

    // ---- Sensor readout ----
    const last = [...dataArray].sort((a, b) => b.timestamp - a.timestamp)[0];
    if (last) {
        const depthEl = document.getElementById('currentDepth');
        if (depthEl) {
            depthEl.textContent = last.depth + ' cm';
            depthEl.style.color = last.status === 'bahaya' ? '#ef4444' :
                                  last.status === 'siaga'  ? '#f59e0b' : '#22c55e';
        }

        setText('currentImu', (last.imuZ || 0) + ' g');
        setText('currentCoord',
            (last.latitude || 0).toFixed(4) + '°, ' + (last.longitude || 0).toFixed(4) + '°');
        setText('currentStep', total);
    }
}

// ============================================================
// UPDATE HISTORY TABLE
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
// UPDATE NOTIF
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
        html += `<div class="notif-item danger">
            <i class="ti ti-alert-triangle"></i>
            Bahaya — ${loc} (${danger.depth} cm)
        </div>`;
    }

    if (warning) {
        const loc = getLocationName(warning);
        html += `<div class="notif-item warning">
            <i class="ti ti-alert-circle"></i>
            Siaga — ${loc} (${warning.depth} cm)
        </div>`;
    }

    if (!html && aman) {
        const loc = getLocationName(aman);
        html = `<div class="notif-item info">
            <i class="ti ti-info-circle"></i>
            Aman — ${loc} (${aman.depth} cm)
        </div>`;
    }

    if (!html) {
        html = '<div class="notif-item info">Sistem normal</div>';
    }

    box.innerHTML = html;
}

// ============================================================
// 🔧 OFF-ROAD STATS — sensor baca genangan di luar jalan
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
// EXPORT GLOBAL
// ============================================================

window.getLocationName = getLocationName;
window.formatTime = formatTime;
window.getStatusLabel = getStatusLabel;
window.updateOffRoadStats = updateOffRoadStats;

console.log('✅ ui.js loaded');