// ============================================================
// MODUL PENGAMBILAN DATA PENELITIAN (KOMPLEKS)
// Mendukung 5 skenario dengan sub-skenario, progress tracking,
// auto-calculation, dan summary statistics
// ============================================================

const RESEARCH_CONFIG = {
    sensor_test: {
        title: 'Pengujian Sensor JSN-SR04T & Klasifikasi',
        target: '≥ 90%',
        targetType: 'accuracy',
        totalPerSub: 5,
        subs: [
            { key: 'aman', label: 'Deteksi Aman (<10 cm)', fields: ['actual', 'reading'] },
            { key: 'siaga', label: 'Deteksi Siaga (10–20 cm)', fields: ['actual', 'reading'] },
            { key: 'bahaya', label: 'Deteksi Bahaya (>20 cm)', fields: ['actual', 'reading'] },
            { key: 'boundary_10', label: 'Batas Aman/Siaga (10 cm)', fields: ['actual', 'reading'] },
            { key: 'boundary_20', label: 'Batas Siaga/Bahaya (20 cm)', fields: ['actual', 'reading'] }
        ],
        fields: {
            actual: { label: 'Ketinggian Aktual (cm)', type: 'number', step: '0.1', required: true },
            reading: { label: 'Pembacaan Sensor (cm)', type: 'number', step: '0.1', required: true },
            notes: { label: 'Catatan', type: 'text', required: false }
        },
        columns: ['No', 'Waktu', 'Sub', 'Aktual (cm)', 'Sensor (cm)', 'Deviasi', 'Akurasi (%)', 'Ulangan', 'Aksi']
    },
    imu_test: {
        title: 'Pengujian Filter IMU MPU-6050',
        target: '100% filter benar',
        targetType: 'filter',
        totalPerSub: 5,
        subs: [
            { key: 'jalan_normal', label: 'Jalan Normal' },
            { key: 'jalan_tidak_rata', label: 'Jalan Tidak Rata' },
            { key: 'lubang_dangkal', label: 'Lubang Dangkal (≤5 cm)' },
            { key: 'lubang_dalam', label: 'Lubang Dalam (>5 cm)' },
            { key: 'polisi_tidur', label: 'Polisi Tidur' }
        ],
        fields: {
            imu_z: { label: 'Akselerasi Z (g)', type: 'number', step: '0.01', required: true },
            filter_status: { label: 'Status Filter', type: 'select', options: ['normal', 'lonjakan'], required: true },
            sensor_data: { label: 'Data Sensor', type: 'select', options: ['diproses', 'diabaikan'], required: true },
            notes: { label: 'Catatan', type: 'text', required: false }
        },
        columns: ['No', 'Waktu', 'Sub', 'IMU Z (g)', 'Status Filter', 'Data Sensor', 'Filter Benar?', 'Ulangan', 'Aksi']
    },
    gps_test: {
        title: 'Pengujian GPS NEO-7M & Geotagging',
        target: '< 5 meter',
        targetType: 'deviation',
        totalPerSub: 10,
        subs: [
            { key: 'diam', label: 'Kendaraan Diam' },
            { key: 'bergerak', label: 'Kendaraan Bergerak' }
        ],
        fields: {
            ref_lat: { label: 'Ref Latitude', type: 'number', step: '0.000001', required: true },
            ref_lng: { label: 'Ref Longitude', type: 'number', step: '0.000001', required: true },
            gps_lat: { label: 'GPS Latitude', type: 'number', step: '0.000001', required: true },
            gps_lng: { label: 'GPS Longitude', type: 'number', step: '0.000001', required: true },
            notes: { label: 'Catatan', type: 'text', required: false }
        },
        columns: ['No', 'Waktu', 'Sub', 'Ref (lat,lng)', 'GPS (lat,lng)', 'Deviasi (m)', 'Status', 'Ulangan', 'Aksi']
    },
    firebase_test: {
        title: 'Pengujian Firebase & Web Dashboard',
        target: '≥ 90% & < 3 dtk',
        targetType: 'mixed',
        totalPerSub: 3,
        subs: [
            { key: 'keandalan', label: 'Keandalan Pengiriman (30 paket)' },
            { key: 'latensi', label: 'Latensi Update' },
            { key: 'marker', label: 'Akurasi Marker' },
            { key: 'reconnect', label: 'Ketahanan Reconnect' }
        ],
        fields: {
            packets_sent: { label: 'Paket Terkirim', type: 'number', required: true },
            packets_received: { label: 'Paket Diterima', type: 'number', required: true },
            latency_s: { label: 'Latensi (detik)', type: 'number', step: '0.01', required: true },
            marker_correct: { label: 'Marker Sesuai', type: 'select', options: ['ya', 'tidak'], required: false },
            reconnect_ok: { label: 'Reconnect Otomatis', type: 'select', options: ['ya', 'tidak'], required: false },
            notes: { label: 'Catatan', type: 'text', required: false }
        },
        columns: ['No', 'Waktu', 'Sub', 'Terkirim', 'Diterima', 'Success (%)', 'Latensi (s)', 'Status', 'Ulangan', 'Aksi']
    },
    endtoend_test: {
        title: 'Pengujian End-to-End & Validasi Polyline',
        target: 'Semua alur berjalan',
        targetType: 'functional',
        totalPerSub: 3,
        subs: [
            { key: 'alur_penuh', label: 'Alur Penuh Deteksi' },
            { key: 'filter_imu', label: 'Alur + Filter IMU' },
            { key: 'stabilitas', label: 'Stabilitas 20 Menit' },
            { key: 'polyline_replay', label: 'Validasi Polyline (Replay 1 km)' }
        ],
        fields: {
            segment_id: { label: 'ID Segmen', type: 'text', required: true },
            start_lat: { label: 'Start Lat', type: 'number', step: '0.000001', required: true },
            start_lng: { label: 'Start Lng', type: 'number', step: '0.000001', required: true },
            end_lat: { label: 'End Lat', type: 'number', step: '0.000001', required: true },
            end_lng: { label: 'End Lng', type: 'number', step: '0.000001', required: true },
            category: { label: 'Kategori', type: 'select', options: ['aman', 'siaga', 'bahaya'], required: true },
            max_depth: { label: 'Kedalaman Maks (cm)', type: 'number', required: true },
            status: { label: 'Status Alur', type: 'select', options: ['berhasil', 'gagal'], required: true },
            notes: { label: 'Catatan', type: 'text', required: false }
        },
        columns: ['No', 'Waktu', 'Sub', 'Segmen', 'Start', 'End', 'Panjang (m)', 'Kategori', 'Status', 'Ulangan', 'Aksi']
    }
};

let currentScenario = 'sensor_test';
let currentSub = null;
let researchData = {};
let sessionStart = null;
let timerInterval = null;
let timerRunning = false;
let sessionElapsed = 0;
let researchChart = null;

// ============================================================
// INIT
// ============================================================

function initResearchModule() {
    renderScenarioTabs();
    switchScenario('sensor_test');
    loadResearchData();
    setupTimer();
}

function renderScenarioTabs() {
    const container = document.getElementById('scenarioTabs');
    let html = '';
    Object.entries(RESEARCH_CONFIG).forEach(([key, cfg]) => {
        html += `<button class="scenario-tab" data-scenario="${key}">
            <i class="ti ti-${getIcon(key)}"></i> ${cfg.title}
        </button>`;
    });
    container.innerHTML = html;

    container.querySelectorAll('.scenario-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            switchScenario(this.dataset.scenario);
        });
    });
}

function getIcon(key) {
    return { sensor_test: 'wave-square', imu_test: 'gyroscope', gps_test: 'satellite',
             firebase_test: 'cloud', endtoend_test: 'route' }[key] || 'flask';
}

function switchScenario(scenario) {
    currentScenario = scenario;
    currentSub = RESEARCH_CONFIG[scenario].subs[0].key;

    document.querySelectorAll('.scenario-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.scenario === scenario);
    });

    document.getElementById('scenarioTitle').textContent = RESEARCH_CONFIG[scenario].title;
    document.getElementById('sumTarget').textContent = RESEARCH_CONFIG[scenario].target;

    renderSubScenarioSelect();
    renderForm();
    renderProgress();
    renderResearchTable();
    renderSummary();
    drawResearchChart();
}

// ============================================================
// SUB-SKENARIO & FORM
// ============================================================

function renderSubScenarioSelect() {
    const config = RESEARCH_CONFIG[currentScenario];
    const select = document.getElementById('subScenarioSelect');
    let html = '';
    config.subs.forEach(sub => {
        const count = getSubCount(sub.key);
        const total = config.totalPerSub;
        const status = count >= total ? '✓' : `${count}/${total}`;
        html += `<option value="${sub.key}" ${sub.key === currentSub ? 'selected' : ''}>
            ${sub.label} — ${status}
        </option>`;
    });
    select.innerHTML = html;

    select.onchange = function() {
        currentSub = this.value;
        renderForm();
    };
}

function getSubCount(subKey) {
    const data = researchData[currentScenario] || {};
    return Object.values(data).filter(e => e.sub === subKey).length;
}

function getNextAttempt() {
    return getSubCount(currentSub) + 1;
}

function renderForm() {
    const config = RESEARCH_CONFIG[currentScenario];
    const sub = config.subs.find(s => s.key === currentSub);
    const form = document.getElementById('dynamicForm');

    const attempt = getNextAttempt();
    const total = config.totalPerSub;
    document.getElementById('formHint').textContent = `Ulangan ke-${attempt} dari ${total}`;

    let html = '';
    if (attempt > total) {
        html += `<div class="form-complete">
            <i class="ti ti-circle-check"></i> Sub-skenario ini sudah selesai (${total}/${total}).
            <br><small>Pilih sub-skenario lain atau reset untuk mengulang.</small>
        </div>`;
        form.innerHTML = html;
        document.getElementById('btnSaveResearch').disabled = true;
        document.getElementById('btnSaveAndNext').disabled = true;
        return;
    }

    Object.entries(config.fields).forEach(([key, field]) => {
        html += `<div class="setting-group">
            <label>${field.label} ${field.required ? '<span style="color:#ef4444;">*</span>' : ''}</label>`;

        if (field.type === 'select') {
            html += `<select class="setting-input research-field" data-key="${key}">`;
            html += `<option value="">-- Pilih --</option>`;
            field.options.forEach(opt => html += `<option value="${opt}">${opt}</option>`);
            html += `</select>`;
        } else {
            html += `<input type="${field.type}" class="setting-input research-field" data-key="${key}"`;
            if (field.step) html += ` step="${field.step}"`;
            if (field.required) html += ` required`;
            html += ` />`;
        }
        html += `</div>`;
    });

    form.innerHTML = html;

    // Auto-calculate live
    form.querySelectorAll('.research-field').forEach(input => {
        input.addEventListener('input', updateLiveCalc);
    });
    updateLiveCalc();

    document.getElementById('btnSaveResearch').disabled = false;
    document.getElementById('btnSaveAndNext').disabled = false;
}

function updateLiveCalc() {
    const el = document.getElementById('liveCalc');
    const vals = {};
    document.querySelectorAll('.research-field').forEach(inp => {
        vals[inp.dataset.key] = inp.value;
    });

    let html = '';

    if (currentScenario === 'sensor_test') {
        if (vals.actual && vals.reading) {
            const dev = Math.abs(parseFloat(vals.reading) - parseFloat(vals.actual));
            const acc = vals.actual > 0 ? (1 - dev / parseFloat(vals.actual)) * 100 : 0;
            html = `<div class="calc-row"><span>Deviasi:</span><strong>${dev.toFixed(2)} cm</strong></div>
                    <div class="calc-row"><span>Akurasi:</span><strong style="color:${acc >= 90 ? '#22c55e' : '#ef4444'};">${acc.toFixed(1)}%</strong></div>`;
        }
    } else if (currentScenario === 'imu_test') {
        if (vals.imu_z && vals.filter_status) {
            const expected = parseFloat(vals.imu_z) > 0.30 ? 'lonjakan' : 'normal';
            const correct = vals.filter_status === expected;
            html = `<div class="calc-row"><span>Threshold:</span><strong>0.30 g</strong></div>
                    <div class="calc-row"><span>Filter Benar?</span><strong style="color:${correct ? '#22c55e' : '#ef4444'};">${correct ? '✓ Ya' : '✗ Tidak'}</strong></div>`;
        }
    } else if (currentScenario === 'gps_test') {
        if (vals.ref_lat && vals.ref_lng && vals.gps_lat && vals.gps_lng) {
            const dev = haversine(parseFloat(vals.ref_lat), parseFloat(vals.ref_lng),
                                  parseFloat(vals.gps_lat), parseFloat(vals.gps_lng));
            html = `<div class="calc-row"><span>Deviasi GPS:</span><strong style="color:${dev < 5 ? '#22c55e' : '#ef4444'};">${dev.toFixed(2)} meter</strong></div>`;
        }
    } else if (currentScenario === 'firebase_test') {
        if (vals.packets_sent && vals.packets_received) {
            const rate = (vals.packets_received / vals.packets_sent) * 100;
            html = `<div class="calc-row"><span>Success Rate:</span><strong style="color:${rate >= 90 ? '#22c55e' : '#ef4444'};">${rate.toFixed(1)}%</strong></div>`;
        }
    } else if (currentScenario === 'endtoend_test') {
        if (vals.start_lat && vals.start_lng && vals.end_lat && vals.end_lng) {
            const len = haversine(parseFloat(vals.start_lat), parseFloat(vals.start_lng),
                                  parseFloat(vals.end_lat), parseFloat(vals.end_lng));
            html = `<div class="calc-row"><span>Panjang Segmen:</span><strong>${len.toFixed(1)} meter</strong></div>`;
        }
    }

    el.innerHTML = html;
}

// ============================================================
// SAVE
// ============================================================

function saveEntry(nextAfterSave) {
    const config = RESEARCH_CONFIG[currentScenario];
    const entry = {
        scenario: currentScenario,
        sub: currentSub,
        attempt: getNextAttempt(),
        timestamp: Date.now()
    };

    let valid = true;
    Object.entries(config.fields).forEach(([key, field]) => {
        const el = document.querySelector(`.research-field[data-key="${key}"]`);
        if (!el) return;
        const val = el.value.trim();
        if (field.required && val === '') { valid = false; return; }
        if (val === '') return;
        entry[key] = field.type === 'number' ? parseFloat(val) : val;
    });

    if (!valid) { alert('⚠️ Mohon isi semua field bertanda *'); return; }

    // Auto-calculate derived fields
    if (currentScenario === 'sensor_test') {
        entry.deviation = Math.abs(entry.reading - entry.actual);
        entry.accuracy = entry.actual > 0 ? (1 - entry.deviation / entry.actual) * 100 : 0;
    } else if (currentScenario === 'imu_test') {
        const expected = parseFloat(entry.imu_z) > 0.30 ? 'lonjakan' : 'normal';
        entry.filter_correct = entry.filter_status === expected;
    } else if (currentScenario === 'gps_test') {
        entry.deviation_m = haversine(entry.ref_lat, entry.ref_lng, entry.gps_lat, entry.gps_lng);
    } else if (currentScenario === 'firebase_test') {
        entry.success_rate = (entry.packets_received / entry.packets_sent) * 100;
    } else if (currentScenario === 'endtoend_test') {
        entry.length_m = haversine(entry.start_lat, entry.start_lng, entry.end_lat, entry.end_lng);
    }

    sendResearchData(currentScenario, entry)
        .then(() => {
            if (!nextAfterSave) {
                alert('✅ Data berhasil disimpan!');
            }
            renderForm();
            renderSubScenarioSelect();
            renderProgress();
        })
        .catch(err => alert('❌ Gagal: ' + err.message));
}

// ============================================================
// LOAD & RENDER DATA
// ============================================================

function loadResearchData() {
    onResearchData((data) => {
        researchData = data;
        renderSubScenarioSelect();
        renderResearchTable();
        renderProgress();
        renderSummary();
        drawResearchChart();
    });
}

function renderResearchTable() {
    const config = RESEARCH_CONFIG[currentScenario];
    const thead = document.getElementById('researchThead');
    const tbody = document.getElementById('researchTbody');

    let headHtml = '<tr>';
    config.columns.forEach(col => headHtml += `<th>${col}</th>`);
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    const data = researchData[currentScenario] || {};
    const entries = Object.entries(data).sort((a, b) => a[1].timestamp - b[1].timestamp);

    if (entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${config.columns.length}" class="empty">Belum ada data</td></tr>`;
        document.getElementById('researchCount').textContent = '(0 entri)';
        return;
    }

    let bodyHtml = '';
    entries.forEach(([key, e], i) => {
        bodyHtml += '<tr>';
        bodyHtml += `<td>${i + 1}</td>`;
        bodyHtml += `<td>${formatTime(e.timestamp)}</td>`;
        bodyHtml += `<td><span class="sub-badge">${e.sub}</span></td>`;

        if (currentScenario === 'sensor_test') {
            bodyHtml += `<td>${e.actual}</td><td>${e.reading}</td>`;
            bodyHtml += `<td>${e.deviation.toFixed(2)}</td>`;
            bodyHtml += `<td><strong style="color:${e.accuracy >= 90 ? '#22c55e' : '#ef4444'};">${e.accuracy.toFixed(1)}%</strong></td>`;
        } else if (currentScenario === 'imu_test') {
            bodyHtml += `<td>${e.imu_z}</td><td>${e.filter_status}</td><td>${e.sensor_data}</td>`;
            bodyHtml += `<td>${e.filter_correct ? '✓' : '✗'}</td>`;
        } else if (currentScenario === 'gps_test') {
            bodyHtml += `<td style="font-size:11px;">${e.ref_lat}, ${e.ref_lng}</td>`;
            bodyHtml += `<td style="font-size:11px;">${e.gps_lat}, ${e.gps_lng}</td>`;
            bodyHtml += `<td><strong style="color:${e.deviation_m < 5 ? '#22c55e' : '#ef4444'};">${e.deviation_m.toFixed(2)}</strong></td>`;
            bodyHtml += `<td>${e.deviation_m < 5 ? '✓' : '✗'}</td>`;
        } else if (currentScenario === 'firebase_test') {
            bodyHtml += `<td>${e.packets_sent}</td><td>${e.packets_received}</td>`;
            bodyHtml += `<td><strong>${e.success_rate.toFixed(1)}%</strong></td>`;
            bodyHtml += `<td>${e.latency_s}</td>`;
            bodyHtml += `<td>${e.success_rate >= 90 ? '✓' : '✗'}</td>`;
        } else if (currentScenario === 'endtoend_test') {
            bodyHtml += `<td>${e.segment_id}</td>`;
            bodyHtml += `<td style="font-size:11px;">${e.start_lat}, ${e.start_lng}</td>`;
            bodyHtml += `<td style="font-size:11px;">${e.end_lat}, ${e.end_lng}</td>`;
            bodyHtml += `<td>${e.length_m.toFixed(1)}</td>`;
            bodyHtml += `<td><span class="status-badge ${e.category}">${e.category}</span></td>`;
            bodyHtml += `<td>${e.status}</td>`;
        }

        bodyHtml += `<td>${e.attempt}</td>`;
        bodyHtml += `<td><button class="btn-icon" onclick="deleteResearchEntry('${currentScenario}','${key}')"><i class="ti ti-trash"></i></button></td>`;
        bodyHtml += '</tr>';
    });

    tbody.innerHTML = bodyHtml;
    document.getElementById('researchCount').textContent = `(${entries.length} entri)`;
}

function deleteResearchEntry(scenario, key) {
    if (!confirm('Hapus entri ini?')) return;
    db.ref(`research_data/${scenario}/${key}`).remove();
}

// ============================================================
// PROGRESS
// ============================================================

function renderProgress() {
    const config = RESEARCH_CONFIG[currentScenario];
    const data = researchData[currentScenario] || {};

    let totalEntries = 0;
    let totalTarget = 0;

    let subHtml = '';
    config.subs.forEach(sub => {
        const count = Object.values(data).filter(e => e.sub === sub.key).length;
        const target = config.totalPerSub;
        totalEntries += Math.min(count, target);
        totalTarget += target;

        const pct = (count / target) * 100;
        const done = count >= target;
        subHtml += `<div class="sub-progress-item">
            <span class="sub-progress-label">${sub.label}</span>
            <div class="sub-progress-bar"><div class="sub-progress-fill ${done ? 'done' : ''}" style="width:${Math.min(pct, 100)}%"></div></div>
            <span class="sub-progress-count ${done ? 'done' : ''}">${count}/${target}</span>
        </div>`;
    });

    const totalPct = totalTarget > 0 ? (totalEntries / totalTarget) * 100 : 0;
    document.getElementById('progressFill').style.width = totalPct + '%';
    document.getElementById('scenarioProgress').textContent = `${totalEntries} / ${totalTarget} ulangan (${totalPct.toFixed(0)}%)`;
    document.getElementById('subScenarioProgress').innerHTML = subHtml;
}

// ============================================================
// SUMMARY & CHART
// ============================================================

function renderSummary() {
    const config = RESEARCH_CONFIG[currentScenario];
    const data = researchData[currentScenario] || {};
    const entries = Object.values(data);

    document.getElementById('sumTotal').textContent = entries.length;
    document.getElementById('sumDuration').textContent = formatDuration(sessionElapsed);

    let values = [];
    if (currentScenario === 'sensor_test') {
        values = entries.map(e => e.accuracy);
    } else if (currentScenario === 'imu_test') {
        values = entries.map(e => e.filter_correct ? 100 : 0);
    } else if (currentScenario === 'gps_test') {
        values = entries.map(e => e.deviation_m);
    } else if (currentScenario === 'firebase_test') {
        values = entries.map(e => e.success_rate);
    } else if (currentScenario === 'endtoend_test') {
        values = entries.map(e => e.length_m);
    }

    if (values.length === 0) {
        document.getElementById('sumAccuracy').textContent = '--';
        document.getElementById('sumStdDev').textContent = '--';
        document.getElementById('sumStatus').textContent = '--';
        return;
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    let unit = '';
    if (currentScenario === 'sensor_test' || currentScenario === 'imu_test' || currentScenario === 'firebase_test') {
        unit = '%';
    } else if (currentScenario === 'gps_test' || currentScenario === 'endtoend_test') {
        unit = ' m';
    }

    document.getElementById('sumAccuracy').textContent = mean.toFixed(2) + unit;
    document.getElementById('sumStdDev').textContent = stdDev.toFixed(2) + unit;

    let status = '--';
    let statusColor = '#94a3b8';
    if (currentScenario === 'sensor_test' || currentScenario === 'imu_test') {
        status = mean >= 90 ? '✓ Tercapai' : '✗ Belum';
        statusColor = mean >= 90 ? '#22c55e' : '#ef4444';
    } else if (currentScenario === 'gps_test') {
        status = mean < 5 ? '✓ Tercapai' : '✗ Belum';
        statusColor = mean < 5 ? '#22c55e' : '#ef4444';
    } else if (currentScenario === 'firebase_test') {
        status = mean >= 90 ? '✓ Tercapai' : '✗ Belum';
        statusColor = mean >= 90 ? '#22c55e' : '#ef4444';
    } else if (currentScenario === 'endtoend_test') {
        const allOk = entries.every(e => e.status === 'berhasil');
        status = allOk ? '✓ Tercapai' : '⚠ Sebagian';
        statusColor = allOk ? '#22c55e' : '#f59e0b';
    }

    const statusEl = document.getElementById('sumStatus');
    statusEl.textContent = status;
    statusEl.style.color = statusColor;
}

function drawResearchChart() {
    const data = researchData[currentScenario] || {};
    const entries = Object.values(data).sort((a, b) => a.timestamp - b.timestamp);

    if (researchChart) researchChart.destroy();

    const ctx = document.getElementById('researchChart').getContext('2d');
    const labels = entries.map((_, i) => `#${i + 1}`);
    let values = [];

    if (currentScenario === 'sensor_test') values = entries.map(e => e.accuracy);
    else if (currentScenario === 'imu_test') values = entries.map(e => e.filter_correct ? 100 : 0);
    else if (currentScenario === 'gps_test') values = entries.map(e => e.deviation_m);
    else if (currentScenario === 'firebase_test') values = entries.map(e => e.success_rate);
    else if (currentScenario === 'endtoend_test') values = entries.map(e => e.length_m);

    researchChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: currentScenario === 'gps_test' ? 'Deviasi (m)' : 'Nilai',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.1)',
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: '#3b82f6'
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
}

// ============================================================
// TIMER
// ============================================================

function setupTimer() {
    document.getElementById('btnTimerToggle').addEventListener('click', () => {
        if (timerRunning) {
            clearInterval(timerInterval);
            timerRunning = false;
            document.getElementById('btnTimerToggle').innerHTML = '<i class="ti ti-player-play"></i>';
        } else {
            sessionStart = Date.now() - sessionElapsed;
            timerInterval = setInterval(() => {
                sessionElapsed = Date.now() - sessionStart;
                document.getElementById('sessionTimer').textContent = formatDuration(sessionElapsed);
            }, 1000);
            timerRunning = true;
            document.getElementById('btnTimerToggle').innerHTML = '<i class="ti ti-player-pause"></i>';
        }
    });
}

function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

// ============================================================
// EXPORT
// ============================================================

function exportCSV() {
    const data = researchData[currentScenario] || {};
    const entries = Object.values(data);
    if (entries.length === 0) { alert('Tidak ada data'); return; }

    const headers = Object.keys(entries[0]);
    let csv = headers.join(',') + '\n';
    entries.forEach(e => {
        csv += headers.map(h => `"${e[h] !== undefined ? e[h] : ''}"`).join(',') + '\n';
    });

    downloadFile(csv, `research_${currentScenario}_${Date.now()}.csv`, 'text/csv');
}

function exportJSON() {
    const data = researchData[currentScenario] || {};
    downloadFile(JSON.stringify(data, null, 2), `research_${currentScenario}_${Date.now()}.json`, 'application/json');
}

function exportAll() {
    downloadFile(JSON.stringify(researchData, null, 2), `research_all_${Date.now()}.json`, 'application/json');
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type: type + ';charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function clearResearchCurrent() {
    if (!confirm(`Hapus SEMUA data "${RESEARCH_CONFIG[currentScenario].title}"?`)) return;
    clearResearchData(currentScenario).then(() => alert('✅ Data dihapus'));
}

// ============================================================
// HAVERSINE
// ============================================================

function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// ============================================================
// EVENT BINDING
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnSaveResearch').addEventListener('click', () => saveEntry(false));
    document.getElementById('btnSaveAndNext').addEventListener('click', () => saveEntry(true));
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
    document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
    document.getElementById('btnExportAll').addEventListener('click', exportAll);
    document.getElementById('btnClearResearch').addEventListener('click', clearResearchCurrent);
});

window.deleteResearchEntry = deleteResearchEntry;