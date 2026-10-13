// ============================================================
// CHARTS.JS — Statistik Visual
// ============================================================

let donutChart = null;
let barChart = null;
let lengthChart = null;
let eventChart = null;

const CHART_COLORS = {
    aman: '#22c55e',
    siaga: '#f59e0b',
    bahaya: '#ef4444',
    blue: '#3b82f6',
    pothole: '#dc2626',
    bump: '#f59e0b'
};

// ============================================================
// UPDATE ALL CHARTS
// ============================================================

function updateCharts(dataArray) {
    if (!dataArray) dataArray = [];

    const aman = dataArray.filter(d => d.status === 'aman').length;
    const siaga = dataArray.filter(d => d.status === 'siaga').length;
    const bahaya = dataArray.filter(d => d.status === 'bahaya').length;

    // --- Donut ---
    const donutEl = document.getElementById('donutChart');
    if (donutEl) {
        if (!donutChart) {
            donutChart = new Chart(donutEl.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Aman', 'Siaga', 'Bahaya'],
                    datasets: [{
                        data: [aman, siaga, bahaya],
                        backgroundColor: [CHART_COLORS.aman, CHART_COLORS.siaga, CHART_COLORS.bahaya],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        } else {
            donutChart.data.datasets[0].data = [aman, siaga, bahaya];
            donutChart.update();
        }
    }

    // --- Bar Tren ---
    const recent = dataArray.slice(-20);
    const labels = recent.map((_, i) => `T-${i + 1}`);
    const depths = recent.map(d => d.depth);
    const colors = recent.map(d => CHART_COLORS[d.status] || CHART_COLORS.blue);

    const barEl = document.getElementById('barChart');
    if (barEl) {
        if (!barChart) {
            barChart = new Chart(barEl.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Kedalaman (cm)',
                        data: depths,
                        backgroundColor: colors,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        } else {
            barChart.data.labels = labels;
            barChart.data.datasets[0].data = depths;
            barChart.data.datasets[0].backgroundColor = colors;
            barChart.update();
        }
    }

    // --- Length per Segmen ---
    updateLengthChart(dataArray);
}

// ============================================================
// LENGTH CHART
// ============================================================

function updateLengthChart(dataArray) {
    const segments = {};
    dataArray.forEach(p => {
        const sid = p.segment_id || 'default';
        if (!segments[sid]) segments[sid] = [];
        segments[sid].push(p);
    });

    const lengths = { aman: 0, siaga: 0, bahaya: 0 };

    Object.values(segments).forEach(points => {
        points.sort((a, b) => a.timestamp - b.timestamp);
        if (points.length < 2) return;

        const avgDepth = points.reduce((s, p) => s + (p.depth || 0), 0) / points.length;
        const cat = avgDepth < 10 ? 'aman' : avgDepth < 20 ? 'siaga' : 'bahaya';

        let segLen = 0;
        for (let i = 1; i < points.length; i++) {
            segLen += haversine(
                points[i-1].latitude, points[i-1].longitude,
                points[i].latitude, points[i].longitude
            );
        }
        lengths[cat] += segLen;
    });

    const el = document.getElementById('lengthChart');
    if (!el) return;

    if (!lengthChart) {
        lengthChart = new Chart(el.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Aman', 'Siaga', 'Bahaya'],
                datasets: [{
                    label: 'Panjang (meter)',
                    data: [lengths.aman, lengths.siaga, lengths.bahaya],
                    backgroundColor: [CHART_COLORS.aman, CHART_COLORS.siaga, CHART_COLORS.bahaya],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, title: { display: true, text: 'Meter' } } }
            }
        });
    } else {
        lengthChart.data.datasets[0].data = [lengths.aman, lengths.siaga, lengths.bahaya];
        lengthChart.update();
    }
}

// ============================================================
// EVENT CHART (Lubang vs Polisi Tidur)
// ============================================================

function updateEventChart(events) {
    const el = document.getElementById('eventChart');
    if (!el) return;

    const arr = Object.values(events || {});
    const potholes = arr.filter(e => e.event_type === 'pothole').length;
    const bumps = arr.filter(e => e.event_type === 'speed_bump').length;

    if (!eventChart) {
        eventChart = new Chart(el.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['🕳️ Lubang', '🚧 Polisi Tidur'],
                datasets: [{
                    data: [potholes, bumps],
                    backgroundColor: [CHART_COLORS.pothole, CHART_COLORS.bump],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    } else {
        eventChart.data.datasets[0].data = [potholes, bumps];
        eventChart.update();
    }
}

console.log('✅ charts.js loaded');