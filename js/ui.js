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

    // Table 10 terbaru
    const tb = document.getElementById('tableBody');
    if (tb) {
        const latest = [...dataArray].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
        tb.innerHTML = latest.map(d => {
            const st = getStatusLabel(d.status);
            return `<tr>
                <td>${formatTime(d.timestamp)}</td>
                <td>${d.location || '-'}</td>
                <td><strong>${d.depth}</strong> cm</td>
                <td><span class="status-badge ${st.cls}">${st.label}</span></td>
            </tr>`;
        }).join('');
    }

    // Sensor readout
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

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
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
        return `<tr>
            <td>${i+1}</td>
            <td>${formatTime(d.timestamp)}</td>
            <td>${d.location || '-'}</td>
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
    if (danger) html += `<div class="notif-item danger"><i class="ti ti-alert-triangle"></i> Bahaya — ${danger.location} (${danger.depth} cm)</div>`;
    if (warning) html += `<div class="notif-item warning"><i class="ti ti-alert-circle"></i> Siaga — ${warning.location} (${warning.depth} cm)</div>`;
    if (!html && aman) html = `<div class="notif-item info"><i class="ti ti-info-circle"></i> Aman — ${aman.location} (${aman.depth} cm)</div>`;
    if (!html) html = '<div class="notif-item info">Sistem normal</div>';

    box.innerHTML = html;
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

console.log('✅ ui.js loaded');