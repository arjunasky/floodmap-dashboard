// ============================================================
// SIMULATOR — Genangan Terputus + Waypoint Rapat
// ============================================================

const SIM = {
    running: false,
    interval: null,
    stepCount: 0,
    currentSegment: null,
    route: [
        // Jl. Toddopuli Raya (dari utara ke selatan, ~10m per titik)
        { lat: -5.14680, lng: 119.45280, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14690, lng: 119.45290, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14700, lng: 119.45300, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14710, lng: 119.45310, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14720, lng: 119.45320, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14730, lng: 119.45330, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14740, lng: 119.45340, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14750, lng: 119.45350, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14760, lng: 119.45360, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14770, lng: 119.45370, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14780, lng: 119.45380, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14790, lng: 119.45390, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14800, lng: 119.45400, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14810, lng: 119.45410, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14820, lng: 119.45420, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14830, lng: 119.45430, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14840, lng: 119.45440, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14850, lng: 119.45450, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14860, lng: 119.45460, name: 'Jl. Toddopuli Raya' },
        { lat: -5.14870, lng: 119.45470, name: 'Jl. Toddopuli Raya' },
        // Tikungan ke Timur
        { lat: -5.14875, lng: 119.45480, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14880, lng: 119.45490, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14885, lng: 119.45500, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14890, lng: 119.45510, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14895, lng: 119.45520, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14900, lng: 119.45530, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14905, lng: 119.45540, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14910, lng: 119.45550, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14915, lng: 119.45560, name: 'Jl. Toddopuli Timur' },
        { lat: -5.14920, lng: 119.45570, name: 'Jl. Toddopuli Timur' },
        // Jl. Toddopuli 10 (balik ke barat)
        { lat: -5.14925, lng: 119.45580, name: 'Jl. Toddopuli 10' },
        { lat: -5.14930, lng: 119.45575, name: 'Jl. Toddopuli 10' },
        { lat: -5.14935, lng: 119.45570, name: 'Jl. Toddopuli 10' },
        { lat: -5.14940, lng: 119.45565, name: 'Jl. Toddopuli 10' },
        { lat: -5.14945, lng: 119.45560, name: 'Jl. Toddopuli 10' },
        { lat: -5.14950, lng: 119.45555, name: 'Jl. Toddopuli 10' },
        { lat: -5.14955, lng: 119.45550, name: 'Jl. Toddopuli 10' },
        { lat: -5.14960, lng: 119.45545, name: 'Jl. Toddopuli 10' },
        { lat: -5.14965, lng: 119.45540, name: 'Jl. Toddopuli 10' },
        { lat: -5.14970, lng: 119.45535, name: 'Jl. Toddopuli 10' },
        // Jl. Toddopuli 16
        { lat: -5.14975, lng: 119.45530, name: 'Jl. Toddopuli 16' },
        { lat: -5.14980, lng: 119.45520, name: 'Jl. Toddopuli 16' },
        { lat: -5.14985, lng: 119.45510, name: 'Jl. Toddopuli 16' },
        { lat: -5.14990, lng: 119.45500, name: 'Jl. Toddopuli 16' },
        { lat: -5.14995, lng: 119.45490, name: 'Jl. Toddopuli 16' },
        { lat: -5.15000, lng: 119.45480, name: 'Jl. Toddopuli 16' },
        { lat: -5.15005, lng: 119.45470, name: 'Jl. Toddopuli 16' },
        { lat: -5.15010, lng: 119.45460, name: 'Jl. Toddopuli 16' },
        { lat: -5.15015, lng: 119.45450, name: 'Jl. Toddopuli 16' },
        { lat: -5.15020, lng: 119.45440, name: 'Jl. Toddopuli 16' },
        // Jl. Toddopuli 7 (balik ke utara)
        { lat: -5.15025, lng: 119.45430, name: 'Jl. Toddopuli 7' },
        { lat: -5.15020, lng: 119.45420, name: 'Jl. Toddopuli 7' },
        { lat: -5.15015, lng: 119.45410, name: 'Jl. Toddopuli 7' },
        { lat: -5.15010, lng: 119.45400, name: 'Jl. Toddopuli 7' },
        { lat: -5.15005, lng: 119.45390, name: 'Jl. Toddopuli 7' },
        { lat: -5.15000, lng: 119.45380, name: 'Jl. Toddopuli 7' },
        { lat: -5.14995, lng: 119.45370, name: 'Jl. Toddopuli 7' },
        { lat: -5.14990, lng: 119.45360, name: 'Jl. Toddopuli 7' },
        { lat: -5.14985, lng: 119.45350, name: 'Jl. Toddopuli 7' },
        { lat: -5.14980, lng: 119.45340, name: 'Jl. Toddopuli 7' },
        { lat: -5.14975, lng: 119.45330, name: 'Jl. Toddopuli 7' },
        { lat: -5.14970, lng: 119.45320, name: 'Jl. Toddopuli 7' },
        { lat: -5.14965, lng: 119.45310, name: 'Jl. Toddopuli 7' },
        { lat: -5.14960, lng: 119.45300, name: 'Jl. Toddopuli 7' },
        { lat: -5.14955, lng: 119.45290, name: 'Jl. Toddopuli 7' },
        { lat: -5.14950, lng: 119.45280, name: 'Jl. Toddopuli 7' },
        { lat: -5.14945, lng: 119.45270, name: 'Jl. Toddopuli 7' },
        { lat: -5.14940, lng: 119.45260, name: 'Jl. Toddopuli 7' },
        { lat: -5.14935, lng: 119.45250, name: 'Jl. Toddopuli 7' },
        { lat: -5.14930, lng: 119.45240, name: 'Jl. Toddopuli 7' },
        { lat: -5.14925, lng: 119.45230, name: 'Jl. Toddopuli 7' },
        { lat: -5.14920, lng: 119.45220, name: 'Jl. Toddopuli 7' }
    ]
};

function log(msg) {
    const el = document.getElementById('simLog');
    const t = new Date().toLocaleTimeString();
    el.innerHTML = `<div>[${t}] ${msg}</div>` + el.innerHTML;
}

function getThresholds() {
    return {
        siaga: parseInt(document.getElementById('thresholdSiaga').value) || 10,
        bahaya: parseInt(document.getElementById('thresholdBahaya').value) || 20
    };
}

// Pola: 4 titik genangan, 3 titik kering, 5 titik genangan, 2 titik kering
function isFlooding(step) {
    const pattern = step % 14;
    return pattern < 4 || (pattern >= 7 && pattern < 12);
}

function createPoint(step) {
    const t = getThresholds();
    const point = SIM.route[step % SIM.route.length];
    const flooding = isFlooding(step);

    if (!flooding) {
        SIM.currentSegment = null;
        return {
            latitude: point.lat, longitude: point.lng,
            depth: 0, status: 'kering',
            location: point.name, timestamp: Date.now(),
            imuZ: 0.05, segment_id: null
        };
    }

    if (!SIM.currentSegment) {
        SIM.currentSegment = `seg_${Date.now()}`;
        log(`🆕 Segmen baru: ${SIM.currentSegment}`);
    }

    const pattern = step % 14;
    let depth;
    if (pattern < 2) depth = 3 + Math.random() * 6;
    else if (pattern < 4) depth = 12 + Math.random() * 7;
    else if (pattern < 9) depth = 22 + Math.random() * 8;
    else depth = 5 + Math.random() * 12;
    depth = Math.round(depth * 10) / 10;

    const status = depth < t.siaga ? 'aman' : depth < t.bahaya ? 'siaga' : 'bahaya';

    return {
        latitude: point.lat, longitude: point.lng,
        depth: depth, status: status,
        location: point.name, timestamp: Date.now(),
        imuZ: parseFloat((0.05 + Math.random() * 0.25).toFixed(2)),
        segment_id: SIM.currentSegment
    };
}

function sendOne() {
    const entry = createPoint(SIM.stepCount);
    SIM.stepCount++;

    if (entry.status === 'kering') {
        log(`○ ${entry.location} | kering | segmen ditutup`);
        return Promise.resolve();
    }

    return sendFloodPoint(entry).then(() => {
        log(`✓ ${entry.location} | ${entry.depth}cm | ${entry.status}`);
    });
}

function startSim() {
    if (SIM.running) return;
    SIM.running = true;
    const speed = parseInt(document.getElementById('simSpeed').value) || 1500;
    SIM.interval = setInterval(() => { if (SIM.running) sendOne(); }, speed);
    log('▶️ Mulai');
    sendOne();
}

function stopSim() {
    SIM.running = false;
    if (SIM.interval) { clearInterval(SIM.interval); SIM.interval = null; }
    log('⏸️ Stop');
}

function resetSim() {
    stopSim();
    SIM.stepCount = 0;
    SIM.currentSegment = null;
    log('⏹️ Reset');
}

async function sendBatch() {
    log('📦 Kirim 30 data...');
    for (let i = 0; i < 30; i++) {
        await sendOne();
        await new Promise(r => setTimeout(r, 300));
    }
    log('✅ Selesai');
}

function clearAll() {
    if (!confirm('Hapus semua data flood_points?')) return;
    clearFloodPoints().then(() => log('🗑️ Dihapus'));
}

document.getElementById('btnStart').addEventListener('click', startSim);
document.getElementById('btnStop').addEventListener('click', stopSim);
document.getElementById('btnReset').addEventListener('click', resetSim);
document.getElementById('btnOne').addEventListener('click', sendOne);
document.getElementById('btnBatch').addEventListener('click', sendBatch);
document.getElementById('btnClear').addEventListener('click', clearAll);

log('Simulator siap.');